import skeletik, {Lexer, Bone, SkeletikParser} from '../skeletik';
import * as utils from './utils';

export interface XBone extends Bone {
	group?:boolean;
	shorty?:boolean;
}

// Shortcut types
const ROOT_TYPE = utils.ROOT_TYPE;
const DTD_TYPE = utils.DTD_TYPE;
const TEXT_TYPE = utils.TEXT_TYPE;
const HIDDEN_CLASS_TYPE = utils.HIDDEN_CLASS_TYPE;
const DEFINE_TYPE = utils.DEFINE_TYPE;
const CALL_TYPE = utils.CALL_TYPE;
const EXPRESSION_TYPE = utils.EXPRESSION_TYPE;
const GROUP_TYPE = utils.GROUP_TYPE;

// Shortcut codes
const ENTER_CODE = utils.ENTER_CODE; // "\n"
const SPACE_CODE = utils.SPACE_CODE; // " "
const DOT_CODE = utils.DOT_CODE; // "."
const COMMA_CODE = utils.COMMA_CODE; // ","
const PIPE_CODE = utils.PIPE_CODE; // "|"
const SLASH_CODE = utils.SLASH_CODE; // "/"
const BACKSLASH_CODE = utils.BACKSLASH_CODE; // "\"
const ASTERISK_CODE = utils.ASTERISK_CODE; // "*"
const OPEN_BRACE_CODE = utils.OPEN_BRACE_CODE; // "{"
const CLOSE_BRACE_CODE = utils.CLOSE_BRACE_CODE; // "}"
const OPEN_BRACKET_CODE = utils.OPEN_BRACKET_CODE; // "["
const CLOSE_BRACKET_CODE = utils.CLOSE_BRACKET_CODE; // "]"
const OPEN_PARENTHESIS_CODE = utils.OPEN_PARENTHESIS_CODE; // "("
const CLOSE_PARENTHESIS_CODE = utils.CLOSE_PARENTHESIS_CODE; // ")"
const HASHTAG_CODE = utils.HASHTAG_CODE; // "#"
const EQUAL_CODE = utils.EQUAL_CODE; // "="
const LT_CODE = utils.LT_CODE; // "<"
const GT_CODE = utils.GT_CODE; // ">"
const PLUS_CODE = utils.PLUS_CODE; // "+"

const KEYWORDS = {};
let _keyword;

const ENTRY_GROUP_STATE = 'entry_group';
const COMMENT_AWAIT_STATE = 'comment_await';
const ID_OR_CLASS_STATE = 'id_or_class';
const INLINE_ATTR_STATE = 'inline_attr';
const INLINE_ATTR_STATE_AWAIT = 'inline_attr_await';
const TEXT_AWAIT = 'text:await';

const TO_KEYWORD_STATE = '>KEYWORD';
const TO_ENTRY_GROUP_STATE = `>${ENTRY_GROUP_STATE}`;

interface INextState {
	to?:string;
	add?:boolean;
	close?:boolean;
	(token:string):INextState;
}

const STOPPER_TO_STATE = {
	[ENTER_CODE]: {
		close: true
	},
	
	[SLASH_CODE]: {
		to: COMMENT_AWAIT_STATE,
		close: true,
	},

	[DOT_CODE]: (token) => (token === 'class') ? {add: false, to: 'class_attr'} : {to: ID_OR_CLASS_STATE},
	
	[HASHTAG_CODE]: ID_OR_CLASS_STATE,

	[PIPE_CODE]: TEXT_AWAIT,
	[OPEN_BRACKET_CODE]: INLINE_ATTR_STATE_AWAIT,
	[EQUAL_CODE]: DEFINE_TYPE,
	[OPEN_PARENTHESIS_CODE]: 'fn-call',

	[OPEN_BRACE_CODE]: TO_ENTRY_GROUP_STATE,
	[CLOSE_BRACE_CODE]: TO_ENTRY_GROUP_STATE,

	[GT_CODE]: TO_ENTRY_GROUP_STATE,
	[PLUS_CODE]: TO_ENTRY_GROUP_STATE,
};

const DEFINE_TYPES = {
	[OPEN_BRACE_CODE]: ['brace', CLOSE_BRACE_CODE], // {}
	[OPEN_BRACKET_CODE]: ['bracket', CLOSE_BRACKET_CODE], // []
	[OPEN_PARENTHESIS_CODE]: ['parenthesis', CLOSE_PARENTHESIS_CODE], // ()
};

const nameStoppersWithSpace = ['|', '/', '(', '>', '+', '{', '}', '=', '\n'];
const nameStoppersWithoutSpace = ['.', '#', '['];

const TAB_INDENT = 'tab';
const SPACE_INDENT = 'space';

let shortAttrType:number;
let inlineAttrName:string;
let indentMode:string;
let indentSize:number;
let prevIndent:number;
let tagNameChain:any[] = [];
let attrValueChain:any[] = [];

// Shortcut methods
const add = utils.add;
const addTag = utils.addTag;
const addComment = utils.addComment;
const addKeyword = utils.addKeyword;
const fail = utils.fail;
const parseXML = utils.parseXML;
const parseJS = utils.parseJS;
const parseJSCallArgs = utils.parseJSCallArgs;
const expressionMixin = utils.expressionMixin;

function addToText(bone:Bone, token:string):void {
	if (token) {
		const value = bone.raw.value;

		if (typeof value === 'string') {
			bone.raw.value += token;
		} else {
			value.push(token);
		}
	}
}

function addAttrValue(lex:Lexer, bone:Bone, name:string, values:any[]):void {
	let list = bone.raw.attrs[name];
	
	if (list === void 0) {
		list = bone.raw.attrs[name] = [];
	}

	attrValueChain = [];

	if (name === 'id' && list.length) {
		lex.error('Duplicate attribute "id" is not allowed', bone);
	}

	list.push(values);
}

function takeInlineAttrName(lex:Lexer, bone) {
	inlineAttrName = lex.takeToken();
	!inlineAttrName && lex.error('Empty attribute name', bone);
}

function setInlineAttr(lex:Lexer, bone:Bone, values):void {
	takeInlineAttrName(lex, bone);
	addAttrValue(lex, bone, inlineAttrName, values)
}

function closeEntry(bone:Bone, group?:boolean, shorty?:boolean):Bone {
	if (group && !(bone as XBone).group) {
		bone = closeEntry(bone);
	}

	bone = bone.parent;

	if (shorty && bone) {
		while ((bone as XBone).shorty) {
			bone = bone.parent;
		}
	}

	return bone;
}

function markAsGroup(lex:Lexer, bone:Bone):string {
	(bone as XBone).group = true;
	return '';
}

function closeGroup(lex:Lexer, bone:Bone):Bone {
	return closeEntry(bone, true);
}

function inheritEntry(type) {
	return {type: 'inherit', raw: type};
}

// Create parser
export default <SkeletikParser>skeletik({
	'$stn': [' ', '\t', '\n'],
	'$id_or_class': ['.', '#'],
	'$name': ['a-z', 'A-Z', '-', '_', '0-9'],
	'$name_stopper': nameStoppersWithoutSpace.concat(nameStoppersWithSpace),
	'$name_stopper_after_space': nameStoppersWithSpace,
	'$attr': ['a-z', 'A-Z', '-', '_', ':', '@', '0-9'],
	'$var_name_start': ['_', 'a-z', 'A-Z'],
	'$var_name_next': ['_', 'a-z', 'A-Z', '0-9'],
	'$define_type': ['[', '{', '('],
	'$ws_mode': ['<', '>']
}, {
	'': {
		'$stn': '->',
		'!': 'dtd',
		'|': TEXT_AWAIT,
		'/': COMMENT_AWAIT_STATE,
		'}': closeGroup,
		'$name': '!entry',
		'$id_or_class': (lex:Lexer, parent:Bone):[Bone,string] => {
			if (lex.peek(+1) === PIPE_CODE) {
				// HTML fragment
				lex.skipNext(2);
				parseXML(lex, parent);
			} else {
				shortAttrType = lex.code;
				return [addTag(parent, 'div'), ID_OR_CLASS_STATE];
			}
		},
		'%': '!hidden_class',
		'$': 'var_or_tag',
		'': fail
	},

	'dtd': {
		'\n': (lex, bone) => { add(bone, DTD_TYPE, {value: lex.takeToken()}); }
	},

	'var_or_tag': {
		'{': (lex, parent) => {
			const expr = parseJS(lex, CLOSE_BRACE_CODE, 1);
			tagNameChain.push({type: EXPRESSION_TYPE, raw: expr});
			return '>entry';
		},
		'': fail
	},

	'entry': expressionMixin(() => tagNameChain, {
		' ': '>entry_stopper:await',
		'$name': '->',
		'$name_stopper': '>entry_stopper',
		'': fail
	}),

	'entry_stopper:await': {
		' ': '->',
		'$name_stopper_after_space': '>entry_stopper',
		'': (lex, parent) => {
			const token = lex.takeToken().trim();
			return KEYWORDS[token] ? [addKeyword(parent, token), keywords.start(token)] : fail(lex, parent);
		}
	},

	'entry_stopper': {
		'': (lex:Lexer, parent:Bone):string|Bone|[Bone, string] => {
			const code = lex.code;
			const token = lex.takeToken().trim();
			let state = <INextState><any>STOPPER_TO_STATE[code];

			switch (typeof state) {
				case 'string': state = <INextState><any>{to: state}; break;
				case 'function': state = state(token); break;
			}

			shortAttrType = code;

			if (KEYWORDS[token]) {
				return [addKeyword(parent, token), keywords.start(token)];
			} else if (state.add !== false && (token || tagNameChain.length)) {
				parent = addTag(parent, token, tagNameChain);
			}

			return [state.close ? closeEntry(parent) : parent, state.to || ''];
		}
	},

	'class_attr': expressionMixin(() => attrValueChain, {
		'&': (lex, bone) => (attrValueChain.push(inheritEntry('self')), '-->'),
		':': (lex, bone) => {
			const token = lex.takeToken();

			token && attrValueChain.push(token);
			
			addAttrValue(lex, bone, 'class', [{
				type: GROUP_TYPE,
				test: parseJS(lex, ENTER_CODE, 1),
				raw: attrValueChain
			}]);

			attrValueChain = [];
		}
	}),

	'hidden_class': {
		'$name_stopper': (lex, bone) => {
			bone = add(bone, HIDDEN_CLASS_TYPE, {attrs: {}});
			addAttrValue(lex, bone, 'class', [inheritEntry('parent'), lex.takeToken(1).trim()]);

			return [bone, SPACE_CODE === lex.code ? 'entry_stopper:await' : TO_ENTRY_GROUP_STATE];
		}
	},

	'id_or_class': expressionMixin(() => attrValueChain, {
		'&': (lex, bone) => (attrValueChain.push(inheritEntry('parent')), '-->'),
		'$name_stopper': (lex, bone) => {
			const code = lex.code;
			const token = lex.takeToken().trim();

			token && attrValueChain.push(token);
			addAttrValue(lex, bone, shortAttrType === DOT_CODE ? 'class' : 'id', attrValueChain);
			
			shortAttrType = code;

			return (HASHTAG_CODE === code || DOT_CODE === code)
				? '-->'
				: (SPACE_CODE === code ? 'entry_stopper:await' : '>entry_stopper')
			;
		}
	}),

	'entry_group': {
		'{': markAsGroup,
		'}': closeGroup,
		'>': (lex, bone) => { (bone as XBone).shorty = true; },
		'+': (lex, bone) => bone.parent,
		'|': TEXT_AWAIT,
		'/': (lex, bone) => [closeEntry(bone), COMMENT_AWAIT_STATE],
		'\n': (lex, bone) => closeEntry(bone),
		' ': '->',
		'': fail // todo: покрыть тестом
	},

	'inline_attr_await': {
		'$stn': '->',
		'$name': '!inline_attr',
		'$ws_mode': '>entry_ws_mode',
		'': fail
	},

	'entry_ws_mode': {
		'$ws_mode': (lex, bone) => {
			bone.raw[lex.takeChar() === '<' ? 'wsBefore' : 'wsAfter'] = true;
			return '-->';
		},
		']': 'inline_attr_next',
		'': fail
	},

	'inline_attr': {
		']': (lex, bone) => {
			setInlineAttr(lex, bone, [true]);
			return 'inline_attr_next';
		},
		'$stn': (lex, bone) => {
			setInlineAttr(lex, bone, [true]);
			return 'inline_attr_next:ws';
		},
		'=': (lex, bone) => (takeInlineAttrName(lex, bone), 'inline_attr_value_await'),
		'$ws': fail,
		'': '->'
	},

	'inline_attr_next:ws': {
		'$stn': '->',
		'$name': '!inline_attr',
		']': 'inline_attr_next',
		'': fail
	},

	'inline_attr_value_await': {
		'"': 'inline_attr_value',
		'': fail
	},

	'inline_attr_value': expressionMixin(() => attrValueChain, {
		'"': (lex, bone) => {
			if (lex.prevCode !== SLASH_CODE) {
				const token = lex.takeToken();
				token && attrValueChain.push(token);
				addAttrValue(lex, bone, inlineAttrName, attrValueChain);
				return 'inline_attr_value_end';
			}

			return '->';
		},
		'\n': fail,
		'': '->'
	}),

	'inline_attr_value_end': {
		'$stn': 'inline_attr_next:ws',
		']': 'inline_attr_next',
		'': fail
	},

	'inline_attr_next': {
		'[': INLINE_ATTR_STATE_AWAIT,
		' ': 'entry_stopper:await',
		'$name_stopper': TO_ENTRY_GROUP_STATE,
		'': fail
	},

	'comment_await': {
		'*': 'multi_comment',
		'/': 'comment',
		'': fail
	},

	'comment': {
		'\n': (lex, parent) => { addComment(parent, lex.takeToken()); }
	},

	'multi_comment': {
		'/': (lex, parent) => {
			if (lex.prevCode === ASTERISK_CODE) {
				addComment(parent, lex.takeToken(0, -1));
			} else {
				return '->';
			}
		}
	},

	'text:await': {
		' ': '->',
		'': (lex, parent) => {
			const multiline = (lex.takeChar() === '>' && PIPE_CODE === lex.prevCode);

			if (multiline) {
				lex.lastIdx++;
				!(parent as XBone).group && ((parent as XBone).shorty = true);
			}

			return [add(parent, TEXT_TYPE, {multiline, value: ''}), '>text'];
		},
	},

	'text': expressionMixin((bone) => {
		let value = bone.raw.value;
		(typeof value === 'string') && (bone.raw.value = value = []);
		return value;
	}, {
		'|': (lex, bone):string|[Bone, string] => {
			if (bone.raw.multiline && LT_CODE === lex.prevCode) {
				addToText(bone, lex.takeToken(0, -1));
				return ENTRY_GROUP_STATE;
			} else {
				return '->';
			}
		},

		'\n': (lex, bone) => {
			if (bone.raw.multiline) {
				return '->';
			}

			addToText(bone, lex.takeToken());

			const parent = bone.parent;

			return (parent.type === ROOT_TYPE || (parent as XBone).group)
				? parent
				: closeEntry(parent, false, true);
		}
	}),

	'KEYWORD': {
		'': (lex, bone) => _keyword.parse(lex, bone)
	},

	'KEYWORD_END': {
		' ': '->',
		'{': markAsGroup,
		'\n': '',
		'': fail
	},

	'KW_TYPE:var': {
		'$var_name_start': '>KW_TYPE_NEXT:var',
		'': fail
	},

	'KW_TYPE_NEXT:var': {
		'$var_name_next': '->',
		'': (lex, bone) => _keyword.attr(bone, lex.takeToken())
	},

	'KW_TYPE:js': {
		'': (lex, bone) => _keyword.attr(bone, parseJS(lex, CLOSE_PARENTHESIS_CODE))
	},

	'define': {
		' ': '->',
		'$define_type': (lex, bone) => {
			const type = DEFINE_TYPES[lex.code];
			bone.type = DEFINE_TYPE;
			bone.raw.type = type[0];
			bone.raw.attrs = [];
			bone.raw.opened = lex.code;
			bone.raw.closed = type[1];
			return 'define:args';
		},
		'': fail,
	},

	'define:args': {
		'$name': '->',
		'': (lex, bone) => {
			const code = lex.code;
			const raw = bone.raw;

			if (COMMA_CODE === code || SPACE_CODE === code || raw.closed === code) {
				const token = lex.takeToken().trim();
				token && raw.attrs.push(token);
				return raw.closed === code ? ENTRY_GROUP_STATE : '-->';
			} else {
				fail(lex, bone)
			}
		}
	},

	'fn-call': {
		'': (lex, bone) => {
			bone.type = CALL_TYPE;
			bone.raw.args = parseJSCallArgs(lex);
			return ENTRY_GROUP_STATE;
		}
	}
}, {
	onstart: () => {
		indentMode = void 0;
		prevIndent = 0;
	},

	onend: (lex, bone) => {
		if (indentMode || (bone as XBone).shorty) {
			while (bone.type !== ROOT_TYPE) {
				bone = bone.parent;

				while ((bone as XBone).shorty) {
					bone = bone.parent;
				}
			}
		}

		if (bone.type !== ROOT_TYPE) {
			lex.error(bone.raw.name + ' not closing');
		}

		return bone;
	},

	onindent: (lex, bone) => {
		const code = lex.code;

		if (
			ENTER_CODE === code ||
			lex.state === 'text' ||
			(SLASH_CODE === code && lex.peek(+1) === SLASH_CODE)
		) {
			return;
		}

		if (lex.indent.tab && lex.indent.space) {
			lex.error('Mixed spaces and tabs');
		}

		const mode = lex.indent.tab ? TAB_INDENT : (lex.indent.space ? SPACE_INDENT : indentMode);

		if (indentMode === void 0) {
			indentMode = mode;
			indentSize = lex.indent[mode];
		} else if (mode !== indentMode) {
			lex.error('Expected indentation with ' + indentMode + ' character', bone, -1);
		}

		if (mode !== void 0) {
			const indent = lex.indent[mode] / indentSize;
			let delta = indent - prevIndent;

			if (indent !== (indent|0) || (delta > 1)) {
				lex.error(
					'Expected indentation of ' +
					indentSize * (indent|0) +
					' ' +
					mode +
					' characters but found ' +
					lex.indent[mode] +
					'.',
					bone,
					-1
				);
			}

			prevIndent = indent;

			if (lex.state !== 'multi_comment' && lex.state !== 'inline_attr_next:ws') {
				// todo: delta > 1
				if (delta === 1 && !(bone as XBone).group) {
					bone = bone.last;
				} else if (delta < 0){
					if ((bone as XBone).group) {
						(delta < -1) && lex.error('Wrong indent'); // todo: нормальную ошибку
					} else {
						while (delta++) {
							bone = bone.parent;

							while ((bone as XBone).shorty) {
								bone = bone.parent;
							}

							if (bone === void 0) {
								lex.error('An error occurred while closing tags');
							}
						}
					}
				}

				return bone;
			}
		}
	}
});

// Keywords
export const keywords = (function () {
	var _name;
	var _attr;
	var _cursor;
	var _variant;

	var parse = skeletik({
		'$ws': [' ', '\t', '\n'],
		'$seq': ['a-z', 'A-Z'],
		'$name': ['a-z', 'A-Z', '-']
	}, {
		'': {
			'@': 'attr',
			'': (lex, bone) => { bone.raw.push(lex.code); },
		},

		'attr': {
			':': (lex, bone) => {
				_attr = lex.takeToken();
				return 'attr:type';
			}
		},

		'attr:type': {
			'$name': '->',
			'': (lex, bone) => {
				bone.raw.push({attr: _attr, type: lex.takeToken()});
				return '>';
			}
		}
	}, {
		onstart: (lex, bone) => { bone.raw = []; }
	});

	return {
		start(name:string):string {
			_name = name;
			_cursor = 0;
			_keyword = KEYWORDS[name];
			_variant = 0;

			return TO_KEYWORD_STATE;
		},

		add(name:string, details:string|string[], options:any = {}) {
			const variants:Array<any[]> = [].concat(details).map((value) => parse(value).raw.slice(0, -1));
			const maxVariants = variants.length;

			KEYWORDS[name] = {
				attr(bone:Bone, value:string) {
					bone.raw.attrs[_attr] = value;
					return TO_KEYWORD_STATE;
				},

				parse(lex:Lexer, bone:Bone) {
					const code = lex.code;
					const seqCode = variants[_variant][_cursor];
					const prevSeqCode = variants[_variant][_cursor - 1];

					if (
						(seqCode === void 0) ||
						((code === OPEN_BRACE_CODE || code === ENTER_CODE) && options.optional)
					) {
						// Конец, либо необязательно
						options.validate && options.validate(lex, bone);
						return '>KEYWORD_END' 
					} else if (code === seqCode) {
						_cursor++;
					} else if (seqCode === SPACE_CODE) {
						_cursor++;
						return TO_KEYWORD_STATE;
					} else if (code === SPACE_CODE && prevSeqCode === SPACE_CODE) {
						// Продолжаем пропускать пробелы
					} else {
						if (maxVariants - _variant > 1) {
							for (var i = _variant; i < maxVariants; i++) {
								if (variants[i][_cursor] === code) {
									_variant = i;
									return this.parse(lex, bone);
								}
							}
						}

						if (seqCode.attr) {
							_attr = seqCode.attr; 
							_cursor++;

							return '>KW_TYPE:' + seqCode.type;
						} else {
							fail(lex, bone);
						}
					}

					return '-->';
				}
			};
		}
	}
})();

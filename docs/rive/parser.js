// RiveScript.js
// https://www.rivescript.com/

// This code is released under the MIT License.
// See the "LICENSE" file for more information.

"use strict";

// Parser for RiveScript syntax.

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var utils = require("./utils");

// The version of the RiveScript language we support.
var RS_VERSION = "2.0";

/**
Parser (RiveScript master)

Create a parser object to handle parsing RiveScript code.
*/
var Parser = function () {
	function Parser(master) {
		_classCallCheck(this, Parser);

		var self = this;
		self.master = master;
		self.strict = master._strict;
		self.utf8 = master._utf8;
	}

	// Proxy functions


	_createClass(Parser, [{
		key: "say",
		value: function say(message) {
			return this.master.say(message);
		}
	}, {
		key: "warn",
		value: function warn(message, filename, lineno) {
			return this.master.warn(message, filename, lineno);
		}

		/**
  object parse (string filename, string code[, func onError])
  	Read and parse a RiveScript document. Returns a data structure that
  represents all of the useful contents of the document, in this format:
  	```javascript
  {
    "begin": { // "begin" data
      "global": {}, // ! global vars
      "var": {},    // ! bot vars
      "sub": {},    // ! sub substitutions
      "person": {}, // ! person substitutions
      "array": {},  // ! array lists
    },
    "topics": { // main reply data
      "random": { // (topic name)
        "includes": {}, // included topics
        "inherits": {}, // inherited topics
        "triggers": [ // array of triggers
          {
            "trigger": "hello bot",
            "reply": [], // array of replies
            "condition": [], // array of conditions
            "redirect": "",  // @ redirect command
            "previous": null, // % previous command
          },
          ...
        ]
      }
    },
    "objects": [ // parsed object macros
      {
        "name": "",     // object name
        "language": "", // programming language
        "code": [],     // object source code (in lines)
      }
    ]
  }
  ```
  	onError function receives: `(err string[, filename str, line_no int])`
  */

	}, {
		key: "parse",
		value: function parse(filename, code, onError) {
			var self = this;

			if (onError === undefined) {
				onError = function onError(err, filename, lineno) {
					self.warn(err, filename, lineno);
				};
			}

			// Eventual return structure ("abstract syntax tree" except not really)
			var ast = {
				begin: {
					global: {},
					var: {},
					sub: {},
					person: {},
					array: {}
				},
				topics: {},
				objects: []
			};

			// Track temporary variables.
			var topic = "random"; // Default topic = random
			var comment = false; // In a multi-line comment.
			var inobj = false; // In an object macro
			var objName = ""; // Name of the object we're in
			var objLang = ""; // The programming language of the object
			var objBuf = []; // Source code buffer of the object
			var curTrig = null; // Pointer to the current trigger in the ast.topics
			var lastcmd = ""; // Last command code
			var isThat = null; // Is a %Previous trigger

			// Local (file scoped) parser options
			var localOptions = {
				concat: self.master._concat != null ? self.master._concat : "none"
			};

			// Supported concat modes for `! local concat`
			var concatModes = {
				none: "",
				newline: "\n",
				space: " "
			};

			// Go through the lines of code.
			var lines = code.split("\n");
			for (var lp = 0, len = lines.length; lp < len; lp++) {
				var line = lines[lp];
				var lineno = lp + 1;

				// Strip the line.
				line = utils.strip(line);
				if (line.length === 0) {
					continue; // Skip blank lines!
				}

				//-----------------------------
				// Are we inside an `> object`?
				//-----------------------------
				if (inobj) {
					// End of the object?
					if (line.indexOf("< object") > -1 || line.indexOf("<object") > -1) {
						// TODO
						// End the object.
						if (objName.length > 0) {
							ast.objects.push({
								name: objName,
								language: objLang,
								code: objBuf
							});
						}
						objName = objLang = "";
						objBuf = [];
						inobj = false;
					} else {
						objBuf.push(line);
					}
					continue;
				}

				//------------------
				// Look for comments
				//------------------
				if (line.indexOf("//") === 0) {
					// Single line comment
					continue;
				} else if (line.indexOf("#") === 0) {
					// Old style single line comment
					self.warn("Using the # symbol for comments is deprecated", filename, lineno);
					continue;
				} else if (line.indexOf("/*") === 0) {
					// Start of a multi-line comment.
					if (line.indexOf("*/") > -1) {
						// The end comment is on the same line!
						continue;
					}

					// We're now inside a multi-line comment.
					comment = true;
					continue;
				} else if (line.indexOf("*/") > -1) {
					// End of a multi-line comment.
					comment = false;
					continue;
				}
				if (comment) {
					continue;
				}

				// Separate the command from the data
				if (line.length < 2) {
					self.warn("Weird single-character line '" + line + "' found (in topic " + topic + ")", filename, lineno);
					continue;
				}

				var cmd = line.substring(0, 1);
				line = utils.strip(line.substring(1));

				// Ignore in-line comments if there's a space before and after the "//"
				if (line.indexOf(" //") > -1) {
					line = utils.strip(line.split(" //")[0]);
				}

				// Allow the ?Keyword command to work around UTF-8 bugs for users who
				// wanted to use `+ [*] keyword [*]` with Unicode symbols that don't match
				// properly with the usual "optional wildcard" syntax.
				if (cmd === "?") {
					// The ?Keyword command is really an alias to +Trigger with some workarounds
					// to make it match the keyword _anywhere_, in every variation so it works
					// with Unicode strings.
					var variants = [line, "[*]" + line + "[*]", "*" + line + "*", "[*]" + line + "*", "*" + line + "[*]", line + "*", "*" + line];
					cmd = "+";
					line = "(" + variants.join("|") + ")";
					self.say("Rewrote ?Keyword as +Trigger: " + line);
				}

				// In the event of a +Trigger, if we are force-lowercasing it, then do so
				// now before the syntax check.
				if (self.master._forceCase === true && cmd === "+") {
					line = line.toLowerCase();
				}

				// Run a syntax check on this line.
				var syntaxError = self.checkSyntax(cmd, line);
				if (syntaxError !== "") {
					if (self.strict) {
						onError.call(null, "Syntax error: " + syntaxError + " at " + filename + " line " + lineno + " near " + cmd + " " + line);
					} else {
						self.warn("Syntax error: " + syntaxError + " at " + filename + " line " + lineno + " near " + cmd + " " + line + " (in topic " + topic + ")");
					}
				}

				// Reset the %Previous state if this is a new +Trigger.
				if (cmd === "+") {
					isThat = null;
				}

				self.say("Cmd: " + cmd + "; line: " + line);
				// Do a look-ahead for ^Continue and %Previous commands.
				for (var li = lp + 1, len2 = lines.length; li < len2; li++) {
					var lookahead = lines[li];
					lookahead = utils.strip(lookahead);
					if (lookahead.length < 2) {
						continue;
					}

					var lookCmd = lookahead.substring(0, 1);
					lookahead = utils.strip(lookahead.substring(1));

					// We only care about a couple lookahead command types.
					if (lookCmd !== "%" && lookCmd !== "^") {
						break;
					}

					// Only continue if the lookahead has any data.
					if (lookahead.length === 0) {
						break;
					}

					self.say("\tLookahead " + li + ": " + lookCmd + " " + lookahead);

					// If the current command is a +, see if the following is a %.
					if (cmd === "+") {
						if (lookCmd === "%") {
							isThat = lookahead;
							break;
						} else {
							isThat = null;
						}
					}

					// If the current command is a ! and the next command(s) are ^ we'll
					// tack each extension on as a line break (which is useful information
					// for arrays).
					if (cmd === "!") {
						if (lookCmd === "^") {
							line += "<crlf>" + lookahead;
						}
						continue;
					}

					// If the current command is not a ^, and the line after is not a %,
					// but the line after IS a ^, then tack it on to the end of the current
					// line.
					if (cmd !== "^" && lookCmd !== "%") {
						if (lookCmd === "^") {
							// Which character to concatenate with?
							if (concatModes[localOptions.concat] !== void 0) {
								line += concatModes[localOptions.concat] + lookahead;
							} else {
								line += lookahead;
							}
						} else {
							break;
						}
					}
				}

				var type = "",
				    name = "";

				// Handle the types of RiveScript commands.
				switch (cmd) {
					case "!":
						// ! Define
						var halves = line.split("=", 2);
						var left = utils.strip(halves[0]).split(" ");
						var value = "";
						name = "";
						type = "";
						if (halves.length === 2) {
							value = utils.strip(halves[1]);
						}

						if (left.length >= 1) {
							type = utils.strip(left[0]);
							if (left.length >= 2) {
								left.shift();
								name = utils.strip(left.join(" "));
							}
						}

						// Remove 'fake' line breaks unless this is an array.
						if (type !== "array") {
							value = value.replace(/<crlf>/g, "");
						}

						// Handle version numbers.
						if (type === "version") {
							if (parseFloat(value) > parseFloat(RS_VERSION)) {
								onError.call(null, "Unsupported RiveScript version. We only support " + RS_VERSION + " at " + filename + " line " + lineno, filename, lineno);
								return ast;
							}
							continue;
						}

						// All other types of defines require a value and variable name.
						if (name.length === 0) {
							self.warn("Undefined variable name", filename, lineno);
							continue;
						}
						if (value.length === 0) {
							self.warn("Undefined variable value", filename, lineno);
							continue;
						}

						// Handle the rest of the !Define types.
						switch (type) {
							case "local":
								// Local file-scoped parser options.
								self.say("\tSet local parser option " + name + " = " + value);
								localOptions[name] = value;
								break;
							case "global":
								// Set a 'global' variable.
								self.say("\tSet global " + name + " = " + value);
								ast.begin.global[name] = value;
								break;
							case "var":
								// Bot variables.
								self.say("\tSet bot variable " + name + " = " + value);
								ast.begin.var[name] = value;
								break;
							case "array":
								// Arrays
								if (value === "<undef>") {
									ast.begin.array[name] = "<undef>";
									continue;
								}

								// Did this have multiple parts?
								var parts = value.split("<crlf>");

								// Process each line of array data.
								var _fields = [];
								for (var l = 0, _len = parts.length; l < _len; l++) {
									var val = parts[l];
									if (val.indexOf("|") > -1) {
										_fields.push.apply(_fields, val.split("|"));
									} else {
										_fields.push.apply(_fields, val.split(" "));
									}
								}

								// Convert any remaining '\s' over.
								for (var i = 0, len3 = _fields.length; i < len3; i++) {
									var field = _fields[i];
									_fields[i] = _fields[i].replace(/\\s/ig, " ");
								}

								// Delete any empty fields.
								_fields = _fields.filter(function (val) {
									return val !== '';
								});

								self.say("\tSet array " + name + " = " + JSON.stringify(_fields));
								ast.begin.array[name] = _fields;
								break;
							case "sub":
								// Substitutions
								self.say("\tSet substitution " + name + " = " + value);
								ast.begin.sub[name] = value;
								break;
							case "person":
								// Person substitutions
								self.say("\tSet person substitution " + name + " = " + value);
								ast.begin.person[name] = value;
								break;
							default:
								self.warn("Unknown definition type " + type, filename, lineno);
						}
						break;
					case ">":
						// > Label
						var temp = utils.strip(line).split(" ");
						type = temp.shift();
						name = "";
						var fields = [];
						if (temp.length > 0) {
							name = temp.shift();
						}
						if (temp.length > 0) {
							fields = temp;
						}

						// Handle the label types.
						switch (type) {
							case "begin":
							case "topic":
								if (type === "begin") {
									self.say("Found the BEGIN block.");
									type = "topic";
									name = "__begin__";
								}

								// Force case on topics.
								if (self.master._forceCase === true) {
									name = name.toLowerCase();
								}

								// Starting a new topic.
								self.say("Set topic to " + name);
								curTrig = null;
								topic = name;

								// Initialize the topic tree.
								self.initTopic(ast.topics, topic);

								// Does this topic include or inherit another one?
								var mode = "";
								if (fields.length >= 2) {
									for (var n = 0, len4 = fields.length; n < len4; n++) {
										var _field = fields[n];
										if (_field === "includes" || _field === "inherits") {
											mode = _field;
										} else if (mode !== "") {
											// This topic is either inherited or included.
											ast.topics[topic][mode][_field] = 1;
										}
									}
								}
								break;
							case "object":
								// If a field was provided, it should be the programming language.
								var lang = "";
								if (fields.length > 0) {
									lang = fields[0].toLowerCase();
								}

								// Missing language, try to assume it's JS.
								if (lang === "") {
									self.warn("Trying to parse unknown programming language", filename, lineno);
									lang = "javascript";
								}

								// Start reading the object code.
								objName = name;
								objLang = lang;
								objBuf = [];
								inobj = true;
								break;
							default:
								self.warn("Unknown label type " + type, filename, lineno);
						}
						break;
					case "<":
						// < Label
						type = line;
						if (type === "begin" || type === "topic") {
							self.say("\tEnd the topic label.");
							topic = "random";
						} else if (type === "object") {
							self.say("\tEnd the object label.");
							inobj = false;
						}
						break;
					case "+":
						// + Trigger
						self.say("\tTrigger pattern: " + line);

						// Initialize the trigger tree.
						self.initTopic(ast.topics, topic);
						curTrig = {
							trigger: line,
							reply: [],
							condition: [],
							redirect: null,
							previous: isThat
						};
						ast.topics[topic].triggers.push(curTrig);
						break;
					case "-":
						// - Response
						if (curTrig === null) {
							self.warn("Response found before trigger", filename, lineno);
							continue;
						}

						// Warn if we also saw a hard redirect.
						if (curTrig.redirect !== null) {
							self.warn("You can't mix @Redirects with -Replies", filename, lineno);
						}

						self.say("\tResponse: " + line);
						curTrig.reply.push(line);
						break;
					case "*":
						// * Condition
						if (curTrig === null) {
							self.warn("Condition found before trigger", filename, lineno);
							continue;
						}

						// Warn if we also saw a hard redirect.
						if (curTrig.redirect !== null) {
							self.warn("You can't mix @Redirects with *Conditions", filename, lineno);
						}

						self.say("\tCondition: " + line);
						curTrig.condition.push(line);
						break;
					case "%":
						// % Previous
						continue; // This was handled above
					case "^":
						// ^ Continue
						continue; // This was handled above
					case "@":
						// @ Redirect
						// Make sure they didn't mix them with incompatible commands.
						if (curTrig.reply.length > 0 || curTrig.condition.length > 0) {
							self.warn("You can't mix @Redirects with -Replies or *Conditions", filename, lineno);
						}
						self.say("\tRedirect response to: " + line);
						curTrig.redirect = utils.strip(line);
						break;
					default:
						self.warn("Unknown command '" + cmd + "' (in topic " + topic + ")", filename, lineno);
				}
			}

			return ast;
		}

		/**
  string stringify (data deparsed)
  	Translate deparsed data into the source code of a RiveScript document.
  See the `stringify()` method on the parent RiveScript class; this is its
  implementation.
  */

	}, {
		key: "stringify",
		value: function stringify(deparsed) {
			var self = this;

			if (deparsed == null) {
				deparsed = self.master.deparse();
			}

			// Helper function to write out the contents of triggers.
			var _writeTriggers = function _writeTriggers(triggers, indent) {
				var id = indent ? "\t" : "";
				var output = [];
				for (var j = 0, len = triggers.length; j < len; j++) {
					var t = triggers[j];
					output.push(id + "+ " + t.trigger);
					if (t.previous) {
						output.push(id + "% " + t.previous);
					}
					if (t.condition) {
						for (var k = 0, len1 = t.condition.length; k < len1; k++) {
							var c = t.condition[k];
							output.push(id + "* " + c.replace(/\n/mg, "\\n"));
						}
					}
					if (t.redirect) {
						output.push(id + "@ " + t.redirect);
					}
					if (t.reply) {
						for (var l = 0, len2 = t.reply.length; l < len2; l++) {
							var r = t.reply[l];
							if (r) {
								output.push(id + "- " + r.replace(/\n/mg, "\\n"));
							}
						}
					}
					output.push("");
				}
				return output;
			};

			// Lines of code to return.
			var source = ["! version = 2.0", "! local concat = none", ""];
			var ref = ["global", "var", "sub", "person", "array"];

			// Stringify begin-like data first.
			for (var j = 0, len = ref.length; j < len; j++) {
				var begin = ref[j];
				if (deparsed.begin[begin] != null && Object.keys(deparsed.begin[begin]).length) {
					for (var key in deparsed.begin[begin]) {
						var value = deparsed.begin[begin][key];
						if (!deparsed.begin[begin].hasOwnProperty(key)) {
							continue;
						}

						// Arrays need special treatment, all others are simple.
						if (begin !== "array") {
							source.push("! " + begin + " " + key + " = " + value);
						} else {
							// Array elements need to be joined by either spaces or pipes.
							var pipes = " ";
							for (var k = 0, len1 = value.length; k < len1; k++) {
								var test = value[k];
								if (test.match(/\s+/)) {
									pipes = "|";
									break;
								}
							}
							source.push("! " + begin + " " + key + " = " + value.join(pipes));
						}
					}
					source.push("");
				}
			}

			// Do objects. Requires stripping out the actual function wrapper
			if (deparsed.objects) {
				for (var lang in deparsed.objects) {
					if (deparsed.objects[lang] && deparsed.objects[lang]._objects) {
						for (var func in deparsed.objects[lang]._objects) {
							source.push("> object " + func + " " + lang);
							source.push(deparsed.objects[lang]._objects[func].toString().match(/function[^{]+\{\n*([\s\S]*)\}\;?\s*$/m)[1].trim().split("\n").map(function (ln) {
								return "\t" + ln;
							}).join("\n"));
							source.push("< object\n");
						}
					}
				}
			}

			if (deparsed.begin.triggers && deparsed.begin.triggers.length > 0) {
				source.push("> begin\n");
				source.push.apply(source, _writeTriggers(deparsed.begin.triggers, "indent"));
				source.push("< begin\n");
			}

			// Do the topics. Random first!
			var topics = Object.keys(deparsed.topics).sort(function (a, b) {
				return a - b;
			});
			topics.unshift("random");
			var doneRandom = false;
			for (var l = 0, len2 = topics.length; l < len2; l++) {
				var topic = topics[l];
				if (!deparsed.topics.hasOwnProperty(topic)) {
					continue;
				}
				if (topic === "random" && doneRandom) {
					continue;
				}
				if (topic === "random") {
					doneRandom = 1;
				}

				var tagged = false; // Use `> topic` tag; not for random, usually
				var tagline = [];
				if (topic !== "random" || Object.keys(deparsed.inherits[topic]).length > 0 || Object.keys(deparsed.includes[topic]).length > 0) {
					// Topics other than "random" are *always* tagged. Otherwise (for random)
					// it's only tagged if it's found to have includes or inherits. But we
					// wait to see if this is the case because those things are kept in JS
					// objects and third party JS libraries like to inject junk into the root
					// Object prototype...
					if (topic !== "random") {
						tagged = true;
					}

					// Start building the tag line.
					var inherits = [];
					var includes = [];
					for (var i in deparsed.inherits[topic]) {
						if (!deparsed.inherits[topic].hasOwnProperty(i)) {
							continue;
						}
						inherits.push(i);
					}
					for (var _i in deparsed.includes[topic]) {
						if (!deparsed.includes[topic].hasOwnProperty(_i)) {
							continue;
						}
						includes.push(_i);
					}
					if (includes.length > 0) {
						includes.unshift("includes");
						tagline.push.apply(tagline, includes);
						tagged = true;
					}
					if (inherits.length > 0) {
						inherits.unshift("inherits");
						tagline.push.apply(tagline, inherits);
						tagged = true;
					}
				}

				if (tagged) {
					source.push(("> topic " + topic + " " + tagline.join(" ")).trim() + "\n");
				}

				source.push.apply(source, _writeTriggers(deparsed.topics[topic], tagged));

				if (tagged) {
					source.push("< topic\n");
				}
			}
			return source.join("\n");
		}

		/**
  string checkSyntax (char command, string line)
  	Check the syntax of a RiveScript command. `command` is the single character
  command symbol, and `line` is the rest of the line after the command.
  	Returns an empty string on success, or a description of the error on error.
  */

	}, {
		key: "checkSyntax",
		value: function checkSyntax(cmd, line) {
			var self = this;

			// Run syntax tests based on the command used.
			if (cmd === "!") {
				// ! Definition
				// - Must be formatted like this:
				//   ! type name = value
				//   OR
				//   ! type = value
				if (!line.match(/^.+(?:\s+.+|)\s*=\s*.+?$/)) {
					return "Invalid format for !Definition line: must be '! type name = value' OR '! type = value'";
				} else if (line.match(/^array/)) {
					if (line.match(/\=\s?\||\|\s?$/)) {
						return "Piped arrays can't begin or end with a |";
					} else if (line.match(/\|\|/)) {
						return "Piped arrays can't include blank entries";
					}
				}
			} else if (cmd === ">") {
				// > Label
				// - The "begin" label must have only one argument ("begin")
				// - The "topic" label must be lowercased but can inherit other topics
				// - The "object" label must follow the same rules as "topic", but don't
				//   need to be lowercased.
				var parts = line.split(/\s+/);
				if (parts[0] === "begin" && parts.length > 1) {
					return "The 'begin' label takes no additional arguments";
				} else if (parts[0] === "topic") {
					if (!self.master._forceCase && line.match(/[^a-z0-9_\-\s]/)) {
						return "Topics should be lowercased and contain only letters and numbers";
					} else if (line.match(/[^A-Za-z0-9_\-\s]/)) {
						return "Topics should contain only letters and numbers in forceCase mode";
					}
				} else if (parts[0] === "object") {
					if (line.match(/[^A-Za-z0-9_\-\s]/)) {
						return "Objects can only contain numbers and letters";
					}
				}
			} else if (cmd === "+" || cmd === "%" || cmd === "@") {
				// + Trigger, % Previous, @ Redirect
				// This one is strict. The triggers are to be run through the regexp
				// engine, therefore it should be acceptable for the regexp engine.
				// - Entirely lowercase
				// - No symbols except: ( | ) [ ] * _ # { } < > =
				// - All brackets should be matched.
				var parens = 0,
				    square = 0,
				    curly = 0,
				    angle = 0;

				// Look for obvious errors first.
				if (self.utf8) {
					// In UTF-8 mode, most symbols are allowed.
					if (line.match(/[A-Z\\.]/)) {
						return "Triggers can't contain uppercase letters, backslashes or dots in UTF-8 mode";
					}
				} else if (line.match(/[^a-z0-9(|)\[\]*_#@{}<>=\/\s]/)) {
					return "Triggers may only contain lowercase letters, numbers, and these symbols: ( | ) [ ] * _ # { } < > = /";
				} else if (line.match(/\(\||\|\)/)) {
					return "Piped alternations can't begin or end with a |";
				} else if (line.match(/\([^\)].+\|\|.+\)/)) {
					return "Piped alternations can't include blank entries";
				} else if (line.match(/\[\||\|\]/)) {
					return "Piped optionals can't begin or end with a |";
				} else if (line.match(/\[[^\]].+\|\|.+\]/)) {
					return "Piped optionals can't include blank entries";
				}

				// Count the brackets.
				var chars = line.split("");
				for (var j = 0, len = chars.length; j < len; j++) {
					var char = chars[j];
					switch (char) {
						case "(":
							parens++;
							break;
						case ")":
							parens--;
							break;
						case "[":
							square++;
							break;
						case "]":
							square--;
							break;
						case "{":
							curly++;
							break;
						case "}":
							curly--;
							break;
						case "<":
							angle++;
							break;
						case ">":
							angle--;
							break;
					}
				}

				// Any mismatches?
				if (parens !== 0) {
					return "Unmatched parenthesis brackets";
				}
				if (square !== 0) {
					return "Unmatched square brackets";
				}
				if (curly !== 0) {
					return "Unmatched curly brackets";
				}
				if (angle !== 0) {
					return "Unmatched angle brackets";
				}
			} else if (cmd === "*") {
				// * Condition
				// Syntax for a conditional is as follows:
				// * value symbol value => response
				if (!line.match(/^.+?\s*(?:==|eq|!=|ne|<>|<|<=|>|>=)\s*.+?=>.+?$/)) {
					return "Invalid format for !Condition: should be like '* value symbol value => response'";
				}
			}

			// No problems!
			return "";
		}

		/**
  private void initTopic (object topics, string name)
  	Initialize the topic tree for the parsing phase. Sets up the topic under
  ast.topics with all its relevant keys and sub-keys, etc.
  */

	}, {
		key: "initTopic",
		value: function initTopic(topics, name) {
			var self = this;
			if (topics[name] === undefined) {
				topics[name] = {
					includes: {},
					inherits: {},
					triggers: []
				};
			}
		}
	}]);

	return Parser;
}();

module.exports = Parser;
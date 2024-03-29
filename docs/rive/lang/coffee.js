// Generated by CoffeeScript 2.0.0
// RiveScript.js

// This code is released under the MIT License.
// See the "LICENSE" file for more information.

// http://www.rivescript.com/
"use strict";

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var CoffeeObjectHandler, coffee;

coffee = require("coffeescript");

/**
CoffeeObjectHandler (RiveScript master)

CoffeeScript Language Support for RiveScript Macros. This language is not
enabled by default; to enable CoffeeScript object macros:

```coffeescript
CoffeeObjectHandler = require "rivescript/lang/coffee"
bot.setHandler "coffee", new CoffeeObjectHandler
```
*/
CoffeeObjectHandler = function () {
	function CoffeeObjectHandler(master) {
		_classCallCheck(this, CoffeeObjectHandler);

		this._master = master;
		this._objects = {};
	}

	/**
 void load (string name, string[] code)
 	Called by the RiveScript object to load CoffeeScript code.
 */


	_createClass(CoffeeObjectHandler, [{
		key: "load",
		value: function load(name, code) {
			var e, source;
			// We need to make a dynamic CoffeeScript function.
			source = "this._objects[\"" + name + "\"] = function(rs, args) {\n" + coffee.compile(code.join("\n"), {
				bare: true
			}) + "}\n";
			try {
				return eval(source);
			} catch (error) {
				e = error;
				return this._master.warn("Error evaluating CoffeeScript object: " + e.message);
			}
		}

		/**
  string call (RiveScript rs, string name, string[] fields)
  	Called by the RiveScript object to execute CoffeeScript code.
  */

	}, {
		key: "call",
		value: function call(rs, name, fields, scope) {
			var e, func, reply;
			// We have it?
			if (!this._objects[name]) {
				return this._master.errors.objectNotFound;
			}
			// Call the dynamic method.
			func = this._objects[name];
			reply = "";
			try {
				reply = func.call(scope, rs, fields);
			} catch (error) {
				e = error;
				reply = "[ERR: Error when executing CoffeeScript object: " + e.message + "]";
			}
			// Allow undefined responses.
			if (reply === void 0) {
				reply = "";
			}
			return reply;
		}
	}]);

	return CoffeeObjectHandler;
}();

module.exports = CoffeeObjectHandler;
var app = (function () {
	'use strict';

	function noop() {}

	function run(fn) {
		return fn();
	}

	function blank_object() {
		return Object.create(null);
	}

	function run_all(fns) {
		fns.forEach(run);
	}

	function is_function(thing) {
		return typeof thing === 'function';
	}

	function safe_not_equal(a, b) {
		return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
	}

	function subscribe(component, store, callback) {
		const unsub = store.subscribe(callback);

		component.$$.on_destroy.push(unsub.unsubscribe
			? () => unsub.unsubscribe()
			: unsub);
	}

	function append(target, node) {
		target.appendChild(node);
	}

	function insert(target, node, anchor) {
		target.insertBefore(node, anchor);
	}

	function detach(node) {
		node.parentNode.removeChild(node);
	}

	function destroy_each(iterations, detaching) {
		for (let i = 0; i < iterations.length; i += 1) {
			if (iterations[i]) iterations[i].d(detaching);
		}
	}

	function element(name) {
		return document.createElement(name);
	}

	function text(data) {
		return document.createTextNode(data);
	}

	function space() {
		return text(' ');
	}

	function empty() {
		return text('');
	}

	function listen(node, event, handler, options) {
		node.addEventListener(event, handler, options);
		return () => node.removeEventListener(event, handler, options);
	}

	function attr(node, attribute, value) {
		if (value == null) node.removeAttribute(attribute);
		else node.setAttribute(attribute, value);
	}

	function children(element) {
		return Array.from(element.childNodes);
	}

	function set_data(text, data) {
		data = '' + data;
		if (text.data !== data) text.data = data;
	}

	let current_component;

	function set_current_component(component) {
		current_component = component;
	}

	function get_current_component() {
		if (!current_component) throw new Error(`Function called outside component initialization`);
		return current_component;
	}

	function onMount(fn) {
		get_current_component().$$.on_mount.push(fn);
	}

	const dirty_components = [];

	const resolved_promise = Promise.resolve();
	let update_scheduled = false;
	const binding_callbacks = [];
	const render_callbacks = [];
	const flush_callbacks = [];

	function schedule_update() {
		if (!update_scheduled) {
			update_scheduled = true;
			resolved_promise.then(flush);
		}
	}

	function add_binding_callback(fn) {
		binding_callbacks.push(fn);
	}

	function add_render_callback(fn) {
		render_callbacks.push(fn);
	}

	function add_flush_callback(fn) {
		flush_callbacks.push(fn);
	}

	function flush() {
		const seen_callbacks = new Set();

		do {
			// first, call beforeUpdate functions
			// and update components
			while (dirty_components.length) {
				const component = dirty_components.shift();
				set_current_component(component);
				update(component.$$);
			}

			while (binding_callbacks.length) binding_callbacks.shift()();

			// then, once components are updated, call
			// afterUpdate functions. This may cause
			// subsequent updates...
			while (render_callbacks.length) {
				const callback = render_callbacks.pop();
				if (!seen_callbacks.has(callback)) {
					callback();

					// ...so guard against infinite loops
					seen_callbacks.add(callback);
				}
			}
		} while (dirty_components.length);

		while (flush_callbacks.length) {
			flush_callbacks.pop()();
		}

		update_scheduled = false;
	}

	function update($$) {
		if ($$.fragment) {
			$$.update($$.dirty);
			run_all($$.before_render);
			$$.fragment.p($$.dirty, $$.ctx);
			$$.dirty = null;

			$$.after_render.forEach(add_render_callback);
		}
	}

	let outros;

	function group_outros() {
		outros = {
			remaining: 0,
			callbacks: []
		};
	}

	function check_outros() {
		if (!outros.remaining) {
			run_all(outros.callbacks);
		}
	}

	function on_outro(callback) {
		outros.callbacks.push(callback);
	}

	function bind(component, name, callback) {
		if (component.$$.props.indexOf(name) === -1) return;
		component.$$.bound[name] = callback;
		callback(component.$$.ctx[name]);
	}

	function mount_component(component, target, anchor) {
		const { fragment, on_mount, on_destroy, after_render } = component.$$;

		fragment.m(target, anchor);

		// onMount happens after the initial afterUpdate. Because
		// afterUpdate callbacks happen in reverse order (inner first)
		// we schedule onMount callbacks before afterUpdate callbacks
		add_render_callback(() => {
			const new_on_destroy = on_mount.map(run).filter(is_function);
			if (on_destroy) {
				on_destroy.push(...new_on_destroy);
			} else {
				// Edge case - component was destroyed immediately,
				// most likely as a result of a binding initialising
				run_all(new_on_destroy);
			}
			component.$$.on_mount = [];
		});

		after_render.forEach(add_render_callback);
	}

	function destroy(component, detaching) {
		if (component.$$) {
			run_all(component.$$.on_destroy);
			component.$$.fragment.d(detaching);

			// TODO null out other refs, including component.$$ (but need to
			// preserve final state?)
			component.$$.on_destroy = component.$$.fragment = null;
			component.$$.ctx = {};
		}
	}

	function make_dirty(component, key) {
		if (!component.$$.dirty) {
			dirty_components.push(component);
			schedule_update();
			component.$$.dirty = {};
		}
		component.$$.dirty[key] = true;
	}

	function init(component, options, instance, create_fragment, not_equal$$1, prop_names) {
		const parent_component = current_component;
		set_current_component(component);

		const props = options.props || {};

		const $$ = component.$$ = {
			fragment: null,
			ctx: null,

			// state
			props: prop_names,
			update: noop,
			not_equal: not_equal$$1,
			bound: blank_object(),

			// lifecycle
			on_mount: [],
			on_destroy: [],
			before_render: [],
			after_render: [],
			context: new Map(parent_component ? parent_component.$$.context : []),

			// everything else
			callbacks: blank_object(),
			dirty: null
		};

		let ready = false;

		$$.ctx = instance
			? instance(component, props, (key, value) => {
				if ($$.ctx && not_equal$$1($$.ctx[key], $$.ctx[key] = value)) {
					if ($$.bound[key]) $$.bound[key](value);
					if (ready) make_dirty(component, key);
				}
			})
			: props;

		$$.update();
		ready = true;
		run_all($$.before_render);
		$$.fragment = create_fragment($$.ctx);

		if (options.target) {
			if (options.hydrate) {
				$$.fragment.l(children(options.target));
			} else {
				$$.fragment.c();
			}

			if (options.intro && component.$$.fragment.i) component.$$.fragment.i();
			mount_component(component, options.target, options.anchor);
			flush();
		}

		set_current_component(parent_component);
	}

	class SvelteComponent {
		$destroy() {
			destroy(this, true);
			this.$destroy = noop;
		}

		$on(type, callback) {
			const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
			callbacks.push(callback);

			return () => {
				const index = callbacks.indexOf(callback);
				if (index !== -1) callbacks.splice(index, 1);
			};
		}

		$set() {
			// overridden by instance, if it has props
		}
	}

	var isarray = Array.isArray || function (arr) {
	  return Object.prototype.toString.call(arr) == '[object Array]';
	};

	/**
	 * Expose `pathToRegexp`.
	 */
	var pathToRegexp_1 = pathToRegexp;
	var parse_1 = parse;
	var compile_1 = compile;
	var tokensToFunction_1 = tokensToFunction;
	var tokensToRegExp_1 = tokensToRegExp;

	/**
	 * The main path matching regexp utility.
	 *
	 * @type {RegExp}
	 */
	var PATH_REGEXP = new RegExp([
	  // Match escaped characters that would otherwise appear in future matches.
	  // This allows the user to escape special characters that won't transform.
	  '(\\\\.)',
	  // Match Express-style parameters and un-named parameters with a prefix
	  // and optional suffixes. Matches appear as:
	  //
	  // "/:test(\\d+)?" => ["/", "test", "\d+", undefined, "?", undefined]
	  // "/route(\\d+)"  => [undefined, undefined, undefined, "\d+", undefined, undefined]
	  // "/*"            => ["/", undefined, undefined, undefined, undefined, "*"]
	  '([\\/.])?(?:(?:\\:(\\w+)(?:\\(((?:\\\\.|[^()])+)\\))?|\\(((?:\\\\.|[^()])+)\\))([+*?])?|(\\*))'
	].join('|'), 'g');

	/**
	 * Parse a string for the raw tokens.
	 *
	 * @param  {String} str
	 * @return {Array}
	 */
	function parse (str) {
	  var tokens = [];
	  var key = 0;
	  var index = 0;
	  var path = '';
	  var res;

	  while ((res = PATH_REGEXP.exec(str)) != null) {
	    var m = res[0];
	    var escaped = res[1];
	    var offset = res.index;
	    path += str.slice(index, offset);
	    index = offset + m.length;

	    // Ignore already escaped sequences.
	    if (escaped) {
	      path += escaped[1];
	      continue
	    }

	    // Push the current path onto the tokens.
	    if (path) {
	      tokens.push(path);
	      path = '';
	    }

	    var prefix = res[2];
	    var name = res[3];
	    var capture = res[4];
	    var group = res[5];
	    var suffix = res[6];
	    var asterisk = res[7];

	    var repeat = suffix === '+' || suffix === '*';
	    var optional = suffix === '?' || suffix === '*';
	    var delimiter = prefix || '/';
	    var pattern = capture || group || (asterisk ? '.*' : '[^' + delimiter + ']+?');

	    tokens.push({
	      name: name || key++,
	      prefix: prefix || '',
	      delimiter: delimiter,
	      optional: optional,
	      repeat: repeat,
	      pattern: escapeGroup(pattern)
	    });
	  }

	  // Match any characters still remaining.
	  if (index < str.length) {
	    path += str.substr(index);
	  }

	  // If the path exists, push it onto the end.
	  if (path) {
	    tokens.push(path);
	  }

	  return tokens
	}

	/**
	 * Compile a string to a template function for the path.
	 *
	 * @param  {String}   str
	 * @return {Function}
	 */
	function compile (str) {
	  return tokensToFunction(parse(str))
	}

	/**
	 * Expose a method for transforming tokens into the path function.
	 */
	function tokensToFunction (tokens) {
	  // Compile all the tokens into regexps.
	  var matches = new Array(tokens.length);

	  // Compile all the patterns before compilation.
	  for (var i = 0; i < tokens.length; i++) {
	    if (typeof tokens[i] === 'object') {
	      matches[i] = new RegExp('^' + tokens[i].pattern + '$');
	    }
	  }

	  return function (obj) {
	    var path = '';
	    var data = obj || {};

	    for (var i = 0; i < tokens.length; i++) {
	      var token = tokens[i];

	      if (typeof token === 'string') {
	        path += token;

	        continue
	      }

	      var value = data[token.name];
	      var segment;

	      if (value == null) {
	        if (token.optional) {
	          continue
	        } else {
	          throw new TypeError('Expected "' + token.name + '" to be defined')
	        }
	      }

	      if (isarray(value)) {
	        if (!token.repeat) {
	          throw new TypeError('Expected "' + token.name + '" to not repeat, but received "' + value + '"')
	        }

	        if (value.length === 0) {
	          if (token.optional) {
	            continue
	          } else {
	            throw new TypeError('Expected "' + token.name + '" to not be empty')
	          }
	        }

	        for (var j = 0; j < value.length; j++) {
	          segment = encodeURIComponent(value[j]);

	          if (!matches[i].test(segment)) {
	            throw new TypeError('Expected all "' + token.name + '" to match "' + token.pattern + '", but received "' + segment + '"')
	          }

	          path += (j === 0 ? token.prefix : token.delimiter) + segment;
	        }

	        continue
	      }

	      segment = encodeURIComponent(value);

	      if (!matches[i].test(segment)) {
	        throw new TypeError('Expected "' + token.name + '" to match "' + token.pattern + '", but received "' + segment + '"')
	      }

	      path += token.prefix + segment;
	    }

	    return path
	  }
	}

	/**
	 * Escape a regular expression string.
	 *
	 * @param  {String} str
	 * @return {String}
	 */
	function escapeString (str) {
	  return str.replace(/([.+*?=^!:${}()[\]|\/])/g, '\\$1')
	}

	/**
	 * Escape the capturing group by escaping special characters and meaning.
	 *
	 * @param  {String} group
	 * @return {String}
	 */
	function escapeGroup (group) {
	  return group.replace(/([=!:$\/()])/g, '\\$1')
	}

	/**
	 * Attach the keys as a property of the regexp.
	 *
	 * @param  {RegExp} re
	 * @param  {Array}  keys
	 * @return {RegExp}
	 */
	function attachKeys (re, keys) {
	  re.keys = keys;
	  return re
	}

	/**
	 * Get the flags for a regexp from the options.
	 *
	 * @param  {Object} options
	 * @return {String}
	 */
	function flags (options) {
	  return options.sensitive ? '' : 'i'
	}

	/**
	 * Pull out keys from a regexp.
	 *
	 * @param  {RegExp} path
	 * @param  {Array}  keys
	 * @return {RegExp}
	 */
	function regexpToRegexp (path, keys) {
	  // Use a negative lookahead to match only capturing groups.
	  var groups = path.source.match(/\((?!\?)/g);

	  if (groups) {
	    for (var i = 0; i < groups.length; i++) {
	      keys.push({
	        name: i,
	        prefix: null,
	        delimiter: null,
	        optional: false,
	        repeat: false,
	        pattern: null
	      });
	    }
	  }

	  return attachKeys(path, keys)
	}

	/**
	 * Transform an array into a regexp.
	 *
	 * @param  {Array}  path
	 * @param  {Array}  keys
	 * @param  {Object} options
	 * @return {RegExp}
	 */
	function arrayToRegexp (path, keys, options) {
	  var parts = [];

	  for (var i = 0; i < path.length; i++) {
	    parts.push(pathToRegexp(path[i], keys, options).source);
	  }

	  var regexp = new RegExp('(?:' + parts.join('|') + ')', flags(options));

	  return attachKeys(regexp, keys)
	}

	/**
	 * Create a path regexp from string input.
	 *
	 * @param  {String} path
	 * @param  {Array}  keys
	 * @param  {Object} options
	 * @return {RegExp}
	 */
	function stringToRegexp (path, keys, options) {
	  var tokens = parse(path);
	  var re = tokensToRegExp(tokens, options);

	  // Attach keys back to the regexp.
	  for (var i = 0; i < tokens.length; i++) {
	    if (typeof tokens[i] !== 'string') {
	      keys.push(tokens[i]);
	    }
	  }

	  return attachKeys(re, keys)
	}

	/**
	 * Expose a function for taking tokens and returning a RegExp.
	 *
	 * @param  {Array}  tokens
	 * @param  {Array}  keys
	 * @param  {Object} options
	 * @return {RegExp}
	 */
	function tokensToRegExp (tokens, options) {
	  options = options || {};

	  var strict = options.strict;
	  var end = options.end !== false;
	  var route = '';
	  var lastToken = tokens[tokens.length - 1];
	  var endsWithSlash = typeof lastToken === 'string' && /\/$/.test(lastToken);

	  // Iterate over the tokens and create our regexp string.
	  for (var i = 0; i < tokens.length; i++) {
	    var token = tokens[i];

	    if (typeof token === 'string') {
	      route += escapeString(token);
	    } else {
	      var prefix = escapeString(token.prefix);
	      var capture = token.pattern;

	      if (token.repeat) {
	        capture += '(?:' + prefix + capture + ')*';
	      }

	      if (token.optional) {
	        if (prefix) {
	          capture = '(?:' + prefix + '(' + capture + '))?';
	        } else {
	          capture = '(' + capture + ')?';
	        }
	      } else {
	        capture = prefix + '(' + capture + ')';
	      }

	      route += capture;
	    }
	  }

	  // In non-strict mode we allow a slash at the end of match. If the path to
	  // match already ends with a slash, we remove it for consistency. The slash
	  // is valid at the end of a path match, not in the middle. This is important
	  // in non-ending mode, where "/test/" shouldn't match "/test//route".
	  if (!strict) {
	    route = (endsWithSlash ? route.slice(0, -2) : route) + '(?:\\/(?=$))?';
	  }

	  if (end) {
	    route += '$';
	  } else {
	    // In non-ending mode, we need the capturing groups to match as much as
	    // possible by using a positive lookahead to the end or next path segment.
	    route += strict && endsWithSlash ? '' : '(?=\\/|$)';
	  }

	  return new RegExp('^' + route, flags(options))
	}

	/**
	 * Normalize the given path string, returning a regular expression.
	 *
	 * An empty array can be passed in for the keys, which will hold the
	 * placeholder key descriptions. For example, using `/user/:id`, `keys` will
	 * contain `[{ name: 'id', delimiter: '/', optional: false, repeat: false }]`.
	 *
	 * @param  {(String|RegExp|Array)} path
	 * @param  {Array}                 [keys]
	 * @param  {Object}                [options]
	 * @return {RegExp}
	 */
	function pathToRegexp (path, keys, options) {
	  keys = keys || [];

	  if (!isarray(keys)) {
	    options = keys;
	    keys = [];
	  } else if (!options) {
	    options = {};
	  }

	  if (path instanceof RegExp) {
	    return regexpToRegexp(path, keys, options)
	  }

	  if (isarray(path)) {
	    return arrayToRegexp(path, keys, options)
	  }

	  return stringToRegexp(path, keys, options)
	}

	pathToRegexp_1.parse = parse_1;
	pathToRegexp_1.compile = compile_1;
	pathToRegexp_1.tokensToFunction = tokensToFunction_1;
	pathToRegexp_1.tokensToRegExp = tokensToRegExp_1;

	/**
	   * Module dependencies.
	   */

	  

	  /**
	   * Short-cuts for global-object checks
	   */

	  var hasDocument = ('undefined' !== typeof document);
	  var hasWindow = ('undefined' !== typeof window);
	  var hasHistory = ('undefined' !== typeof history);
	  var hasProcess = typeof process !== 'undefined';

	  /**
	   * Detect click event
	   */
	  var clickEvent = hasDocument && document.ontouchstart ? 'touchstart' : 'click';

	  /**
	   * To work properly with the URL
	   * history.location generated polyfill in https://github.com/devote/HTML5-History-API
	   */

	  var isLocation = hasWindow && !!(window.history.location || window.location);

	  /**
	   * The page instance
	   * @api private
	   */
	  function Page() {
	    // public things
	    this.callbacks = [];
	    this.exits = [];
	    this.current = '';
	    this.len = 0;

	    // private things
	    this._decodeURLComponents = true;
	    this._base = '';
	    this._strict = false;
	    this._running = false;
	    this._hashbang = false;

	    // bound functions
	    this.clickHandler = this.clickHandler.bind(this);
	    this._onpopstate = this._onpopstate.bind(this);
	  }

	  /**
	   * Configure the instance of page. This can be called multiple times.
	   *
	   * @param {Object} options
	   * @api public
	   */

	  Page.prototype.configure = function(options) {
	    var opts = options || {};

	    this._window = opts.window || (hasWindow && window);
	    this._decodeURLComponents = opts.decodeURLComponents !== false;
	    this._popstate = opts.popstate !== false && hasWindow;
	    this._click = opts.click !== false && hasDocument;
	    this._hashbang = !!opts.hashbang;

	    var _window = this._window;
	    if(this._popstate) {
	      _window.addEventListener('popstate', this._onpopstate, false);
	    } else if(hasWindow) {
	      _window.removeEventListener('popstate', this._onpopstate, false);
	    }

	    if (this._click) {
	      _window.document.addEventListener(clickEvent, this.clickHandler, false);
	    } else if(hasDocument) {
	      _window.document.removeEventListener(clickEvent, this.clickHandler, false);
	    }

	    if(this._hashbang && hasWindow && !hasHistory) {
	      _window.addEventListener('hashchange', this._onpopstate, false);
	    } else if(hasWindow) {
	      _window.removeEventListener('hashchange', this._onpopstate, false);
	    }
	  };

	  /**
	   * Get or set basepath to `path`.
	   *
	   * @param {string} path
	   * @api public
	   */

	  Page.prototype.base = function(path) {
	    if (0 === arguments.length) return this._base;
	    this._base = path;
	  };

	  /**
	   * Gets the `base`, which depends on whether we are using History or
	   * hashbang routing.

	   * @api private
	   */
	  Page.prototype._getBase = function() {
	    var base = this._base;
	    if(!!base) return base;
	    var loc = hasWindow && this._window && this._window.location;

	    if(hasWindow && this._hashbang && loc && loc.protocol === 'file:') {
	      base = loc.pathname;
	    }

	    return base;
	  };

	  /**
	   * Get or set strict path matching to `enable`
	   *
	   * @param {boolean} enable
	   * @api public
	   */

	  Page.prototype.strict = function(enable) {
	    if (0 === arguments.length) return this._strict;
	    this._strict = enable;
	  };


	  /**
	   * Bind with the given `options`.
	   *
	   * Options:
	   *
	   *    - `click` bind to click events [true]
	   *    - `popstate` bind to popstate [true]
	   *    - `dispatch` perform initial dispatch [true]
	   *
	   * @param {Object} options
	   * @api public
	   */

	  Page.prototype.start = function(options) {
	    var opts = options || {};
	    this.configure(opts);

	    if (false === opts.dispatch) return;
	    this._running = true;

	    var url;
	    if(isLocation) {
	      var window = this._window;
	      var loc = window.location;

	      if(this._hashbang && ~loc.hash.indexOf('#!')) {
	        url = loc.hash.substr(2) + loc.search;
	      } else if (this._hashbang) {
	        url = loc.search + loc.hash;
	      } else {
	        url = loc.pathname + loc.search + loc.hash;
	      }
	    }

	    this.replace(url, null, true, opts.dispatch);
	  };

	  /**
	   * Unbind click and popstate event handlers.
	   *
	   * @api public
	   */

	  Page.prototype.stop = function() {
	    if (!this._running) return;
	    this.current = '';
	    this.len = 0;
	    this._running = false;

	    var window = this._window;
	    this._click && window.document.removeEventListener(clickEvent, this.clickHandler, false);
	    hasWindow && window.removeEventListener('popstate', this._onpopstate, false);
	    hasWindow && window.removeEventListener('hashchange', this._onpopstate, false);
	  };

	  /**
	   * Show `path` with optional `state` object.
	   *
	   * @param {string} path
	   * @param {Object=} state
	   * @param {boolean=} dispatch
	   * @param {boolean=} push
	   * @return {!Context}
	   * @api public
	   */

	  Page.prototype.show = function(path, state, dispatch, push) {
	    var ctx = new Context(path, state, this),
	      prev = this.prevContext;
	    this.prevContext = ctx;
	    this.current = ctx.path;
	    if (false !== dispatch) this.dispatch(ctx, prev);
	    if (false !== ctx.handled && false !== push) ctx.pushState();
	    return ctx;
	  };

	  /**
	   * Goes back in the history
	   * Back should always let the current route push state and then go back.
	   *
	   * @param {string} path - fallback path to go back if no more history exists, if undefined defaults to page.base
	   * @param {Object=} state
	   * @api public
	   */

	  Page.prototype.back = function(path, state) {
	    var page = this;
	    if (this.len > 0) {
	      var window = this._window;
	      // this may need more testing to see if all browsers
	      // wait for the next tick to go back in history
	      hasHistory && window.history.back();
	      this.len--;
	    } else if (path) {
	      setTimeout(function() {
	        page.show(path, state);
	      });
	    } else {
	      setTimeout(function() {
	        page.show(page._getBase(), state);
	      });
	    }
	  };

	  /**
	   * Register route to redirect from one path to other
	   * or just redirect to another route
	   *
	   * @param {string} from - if param 'to' is undefined redirects to 'from'
	   * @param {string=} to
	   * @api public
	   */
	  Page.prototype.redirect = function(from, to) {
	    var inst = this;

	    // Define route from a path to another
	    if ('string' === typeof from && 'string' === typeof to) {
	      page.call(this, from, function(e) {
	        setTimeout(function() {
	          inst.replace(/** @type {!string} */ (to));
	        }, 0);
	      });
	    }

	    // Wait for the push state and replace it with another
	    if ('string' === typeof from && 'undefined' === typeof to) {
	      setTimeout(function() {
	        inst.replace(from);
	      }, 0);
	    }
	  };

	  /**
	   * Replace `path` with optional `state` object.
	   *
	   * @param {string} path
	   * @param {Object=} state
	   * @param {boolean=} init
	   * @param {boolean=} dispatch
	   * @return {!Context}
	   * @api public
	   */


	  Page.prototype.replace = function(path, state, init, dispatch) {
	    var ctx = new Context(path, state, this),
	      prev = this.prevContext;
	    this.prevContext = ctx;
	    this.current = ctx.path;
	    ctx.init = init;
	    ctx.save(); // save before dispatching, which may redirect
	    if (false !== dispatch) this.dispatch(ctx, prev);
	    return ctx;
	  };

	  /**
	   * Dispatch the given `ctx`.
	   *
	   * @param {Context} ctx
	   * @api private
	   */

	  Page.prototype.dispatch = function(ctx, prev) {
	    var i = 0, j = 0, page = this;

	    function nextExit() {
	      var fn = page.exits[j++];
	      if (!fn) return nextEnter();
	      fn(prev, nextExit);
	    }

	    function nextEnter() {
	      var fn = page.callbacks[i++];

	      if (ctx.path !== page.current) {
	        ctx.handled = false;
	        return;
	      }
	      if (!fn) return unhandled.call(page, ctx);
	      fn(ctx, nextEnter);
	    }

	    if (prev) {
	      nextExit();
	    } else {
	      nextEnter();
	    }
	  };

	  /**
	   * Register an exit route on `path` with
	   * callback `fn()`, which will be called
	   * on the previous context when a new
	   * page is visited.
	   */
	  Page.prototype.exit = function(path, fn) {
	    if (typeof path === 'function') {
	      return this.exit('*', path);
	    }

	    var route = new Route(path, null, this);
	    for (var i = 1; i < arguments.length; ++i) {
	      this.exits.push(route.middleware(arguments[i]));
	    }
	  };

	  /**
	   * Handle "click" events.
	   */

	  /* jshint +W054 */
	  Page.prototype.clickHandler = function(e) {
	    if (1 !== this._which(e)) return;

	    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
	    if (e.defaultPrevented) return;

	    // ensure link
	    // use shadow dom when available if not, fall back to composedPath()
	    // for browsers that only have shady
	    var el = e.target;
	    var eventPath = e.path || (e.composedPath ? e.composedPath() : null);

	    if(eventPath) {
	      for (var i = 0; i < eventPath.length; i++) {
	        if (!eventPath[i].nodeName) continue;
	        if (eventPath[i].nodeName.toUpperCase() !== 'A') continue;
	        if (!eventPath[i].href) continue;

	        el = eventPath[i];
	        break;
	      }
	    }

	    // continue ensure link
	    // el.nodeName for svg links are 'a' instead of 'A'
	    while (el && 'A' !== el.nodeName.toUpperCase()) el = el.parentNode;
	    if (!el || 'A' !== el.nodeName.toUpperCase()) return;

	    // check if link is inside an svg
	    // in this case, both href and target are always inside an object
	    var svg = (typeof el.href === 'object') && el.href.constructor.name === 'SVGAnimatedString';

	    // Ignore if tag has
	    // 1. "download" attribute
	    // 2. rel="external" attribute
	    if (el.hasAttribute('download') || el.getAttribute('rel') === 'external') return;

	    // ensure non-hash for the same path
	    var link = el.getAttribute('href');
	    if(!this._hashbang && this._samePath(el) && (el.hash || '#' === link)) return;

	    // Check for mailto: in the href
	    if (link && link.indexOf('mailto:') > -1) return;

	    // check target
	    // svg target is an object and its desired value is in .baseVal property
	    if (svg ? el.target.baseVal : el.target) return;

	    // x-origin
	    // note: svg links that are not relative don't call click events (and skip page.js)
	    // consequently, all svg links tested inside page.js are relative and in the same origin
	    if (!svg && !this.sameOrigin(el.href)) return;

	    // rebuild path
	    // There aren't .pathname and .search properties in svg links, so we use href
	    // Also, svg href is an object and its desired value is in .baseVal property
	    var path = svg ? el.href.baseVal : (el.pathname + el.search + (el.hash || ''));

	    path = path[0] !== '/' ? '/' + path : path;

	    // strip leading "/[drive letter]:" on NW.js on Windows
	    if (hasProcess && path.match(/^\/[a-zA-Z]:\//)) {
	      path = path.replace(/^\/[a-zA-Z]:\//, '/');
	    }

	    // same page
	    var orig = path;
	    var pageBase = this._getBase();

	    if (path.indexOf(pageBase) === 0) {
	      path = path.substr(pageBase.length);
	    }

	    if (this._hashbang) path = path.replace('#!', '');

	    if (pageBase && orig === path && (!isLocation || this._window.location.protocol !== 'file:')) {
	      return;
	    }

	    e.preventDefault();
	    this.show(orig);
	  };

	  /**
	   * Handle "populate" events.
	   * @api private
	   */

	  Page.prototype._onpopstate = (function () {
	    var loaded = false;
	    if ( ! hasWindow ) {
	      return function () {};
	    }
	    if (hasDocument && document.readyState === 'complete') {
	      loaded = true;
	    } else {
	      window.addEventListener('load', function() {
	        setTimeout(function() {
	          loaded = true;
	        }, 0);
	      });
	    }
	    return function onpopstate(e) {
	      if (!loaded) return;
	      var page = this;
	      if (e.state) {
	        var path = e.state.path;
	        page.replace(path, e.state);
	      } else if (isLocation) {
	        var loc = page._window.location;
	        page.show(loc.pathname + loc.search + loc.hash, undefined, undefined, false);
	      }
	    };
	  })();

	  /**
	   * Event button.
	   */
	  Page.prototype._which = function(e) {
	    e = e || (hasWindow && this._window.event);
	    return null == e.which ? e.button : e.which;
	  };

	  /**
	   * Convert to a URL object
	   * @api private
	   */
	  Page.prototype._toURL = function(href) {
	    var window = this._window;
	    if(typeof URL === 'function' && isLocation) {
	      return new URL(href, window.location.toString());
	    } else if (hasDocument) {
	      var anc = window.document.createElement('a');
	      anc.href = href;
	      return anc;
	    }
	  };

	  /**
	   * Check if `href` is the same origin.
	   * @param {string} href
	   * @api public
	   */

	  Page.prototype.sameOrigin = function(href) {
	    if(!href || !isLocation) return false;

	    var url = this._toURL(href);
	    var window = this._window;

	    var loc = window.location;
	    return loc.protocol === url.protocol &&
	      loc.hostname === url.hostname &&
	      loc.port === url.port;
	  };

	  /**
	   * @api private
	   */
	  Page.prototype._samePath = function(url) {
	    if(!isLocation) return false;
	    var window = this._window;
	    var loc = window.location;
	    return url.pathname === loc.pathname &&
	      url.search === loc.search;
	  };

	  /**
	   * Remove URL encoding from the given `str`.
	   * Accommodates whitespace in both x-www-form-urlencoded
	   * and regular percent-encoded form.
	   *
	   * @param {string} val - URL component to decode
	   * @api private
	   */
	  Page.prototype._decodeURLEncodedURIComponent = function(val) {
	    if (typeof val !== 'string') { return val; }
	    return this._decodeURLComponents ? decodeURIComponent(val.replace(/\+/g, ' ')) : val;
	  };

	  /**
	   * Create a new `page` instance and function
	   */
	  function createPage() {
	    var pageInstance = new Page();

	    function pageFn(/* args */) {
	      return page.apply(pageInstance, arguments);
	    }

	    // Copy all of the things over. In 2.0 maybe we use setPrototypeOf
	    pageFn.callbacks = pageInstance.callbacks;
	    pageFn.exits = pageInstance.exits;
	    pageFn.base = pageInstance.base.bind(pageInstance);
	    pageFn.strict = pageInstance.strict.bind(pageInstance);
	    pageFn.start = pageInstance.start.bind(pageInstance);
	    pageFn.stop = pageInstance.stop.bind(pageInstance);
	    pageFn.show = pageInstance.show.bind(pageInstance);
	    pageFn.back = pageInstance.back.bind(pageInstance);
	    pageFn.redirect = pageInstance.redirect.bind(pageInstance);
	    pageFn.replace = pageInstance.replace.bind(pageInstance);
	    pageFn.dispatch = pageInstance.dispatch.bind(pageInstance);
	    pageFn.exit = pageInstance.exit.bind(pageInstance);
	    pageFn.configure = pageInstance.configure.bind(pageInstance);
	    pageFn.sameOrigin = pageInstance.sameOrigin.bind(pageInstance);
	    pageFn.clickHandler = pageInstance.clickHandler.bind(pageInstance);

	    pageFn.create = createPage;

	    Object.defineProperty(pageFn, 'len', {
	      get: function(){
	        return pageInstance.len;
	      },
	      set: function(val) {
	        pageInstance.len = val;
	      }
	    });

	    Object.defineProperty(pageFn, 'current', {
	      get: function(){
	        return pageInstance.current;
	      },
	      set: function(val) {
	        pageInstance.current = val;
	      }
	    });

	    // In 2.0 these can be named exports
	    pageFn.Context = Context;
	    pageFn.Route = Route;

	    return pageFn;
	  }

	  /**
	   * Register `path` with callback `fn()`,
	   * or route `path`, or redirection,
	   * or `page.start()`.
	   *
	   *   page(fn);
	   *   page('*', fn);
	   *   page('/user/:id', load, user);
	   *   page('/user/' + user.id, { some: 'thing' });
	   *   page('/user/' + user.id);
	   *   page('/from', '/to')
	   *   page();
	   *
	   * @param {string|!Function|!Object} path
	   * @param {Function=} fn
	   * @api public
	   */

	  function page(path, fn) {
	    // <callback>
	    if ('function' === typeof path) {
	      return page.call(this, '*', path);
	    }

	    // route <path> to <callback ...>
	    if ('function' === typeof fn) {
	      var route = new Route(/** @type {string} */ (path), null, this);
	      for (var i = 1; i < arguments.length; ++i) {
	        this.callbacks.push(route.middleware(arguments[i]));
	      }
	      // show <path> with [state]
	    } else if ('string' === typeof path) {
	      this['string' === typeof fn ? 'redirect' : 'show'](path, fn);
	      // start [options]
	    } else {
	      this.start(path);
	    }
	  }

	  /**
	   * Unhandled `ctx`. When it's not the initial
	   * popstate then redirect. If you wish to handle
	   * 404s on your own use `page('*', callback)`.
	   *
	   * @param {Context} ctx
	   * @api private
	   */
	  function unhandled(ctx) {
	    if (ctx.handled) return;
	    var current;
	    var page = this;
	    var window = page._window;

	    if (page._hashbang) {
	      current = isLocation && this._getBase() + window.location.hash.replace('#!', '');
	    } else {
	      current = isLocation && window.location.pathname + window.location.search;
	    }

	    if (current === ctx.canonicalPath) return;
	    page.stop();
	    ctx.handled = false;
	    isLocation && (window.location.href = ctx.canonicalPath);
	  }

	  /**
	   * Escapes RegExp characters in the given string.
	   *
	   * @param {string} s
	   * @api private
	   */
	  function escapeRegExp(s) {
	    return s.replace(/([.+*?=^!:${}()[\]|/\\])/g, '\\$1');
	  }

	  /**
	   * Initialize a new "request" `Context`
	   * with the given `path` and optional initial `state`.
	   *
	   * @constructor
	   * @param {string} path
	   * @param {Object=} state
	   * @api public
	   */

	  function Context(path, state, pageInstance) {
	    var _page = this.page = pageInstance || page;
	    var window = _page._window;
	    var hashbang = _page._hashbang;

	    var pageBase = _page._getBase();
	    if ('/' === path[0] && 0 !== path.indexOf(pageBase)) path = pageBase + (hashbang ? '#!' : '') + path;
	    var i = path.indexOf('?');

	    this.canonicalPath = path;
	    var re = new RegExp('^' + escapeRegExp(pageBase));
	    this.path = path.replace(re, '') || '/';
	    if (hashbang) this.path = this.path.replace('#!', '') || '/';

	    this.title = (hasDocument && window.document.title);
	    this.state = state || {};
	    this.state.path = path;
	    this.querystring = ~i ? _page._decodeURLEncodedURIComponent(path.slice(i + 1)) : '';
	    this.pathname = _page._decodeURLEncodedURIComponent(~i ? path.slice(0, i) : path);
	    this.params = {};

	    // fragment
	    this.hash = '';
	    if (!hashbang) {
	      if (!~this.path.indexOf('#')) return;
	      var parts = this.path.split('#');
	      this.path = this.pathname = parts[0];
	      this.hash = _page._decodeURLEncodedURIComponent(parts[1]) || '';
	      this.querystring = this.querystring.split('#')[0];
	    }
	  }

	  /**
	   * Push state.
	   *
	   * @api private
	   */

	  Context.prototype.pushState = function() {
	    var page = this.page;
	    var window = page._window;
	    var hashbang = page._hashbang;

	    page.len++;
	    if (hasHistory) {
	        window.history.pushState(this.state, this.title,
	          hashbang && this.path !== '/' ? '#!' + this.path : this.canonicalPath);
	    }
	  };

	  /**
	   * Save the context state.
	   *
	   * @api public
	   */

	  Context.prototype.save = function() {
	    var page = this.page;
	    if (hasHistory) {
	        page._window.history.replaceState(this.state, this.title,
	          page._hashbang && this.path !== '/' ? '#!' + this.path : this.canonicalPath);
	    }
	  };

	  /**
	   * Initialize `Route` with the given HTTP `path`,
	   * and an array of `callbacks` and `options`.
	   *
	   * Options:
	   *
	   *   - `sensitive`    enable case-sensitive routes
	   *   - `strict`       enable strict matching for trailing slashes
	   *
	   * @constructor
	   * @param {string} path
	   * @param {Object=} options
	   * @api private
	   */

	  function Route(path, options, page) {
	    var _page = this.page = page || globalPage;
	    var opts = options || {};
	    opts.strict = opts.strict || page._strict;
	    this.path = (path === '*') ? '(.*)' : path;
	    this.method = 'GET';
	    this.regexp = pathToRegexp_1(this.path, this.keys = [], opts);
	  }

	  /**
	   * Return route middleware with
	   * the given callback `fn()`.
	   *
	   * @param {Function} fn
	   * @return {Function}
	   * @api public
	   */

	  Route.prototype.middleware = function(fn) {
	    var self = this;
	    return function(ctx, next) {
	      if (self.match(ctx.path, ctx.params)) return fn(ctx, next);
	      next();
	    };
	  };

	  /**
	   * Check if this route matches `path`, if so
	   * populate `params`.
	   *
	   * @param {string} path
	   * @param {Object} params
	   * @return {boolean}
	   * @api private
	   */

	  Route.prototype.match = function(path, params) {
	    var keys = this.keys,
	      qsIndex = path.indexOf('?'),
	      pathname = ~qsIndex ? path.slice(0, qsIndex) : path,
	      m = this.regexp.exec(decodeURIComponent(pathname));

	    if (!m) return false;

	    for (var i = 1, len = m.length; i < len; ++i) {
	      var key = keys[i - 1];
	      var val = this.page._decodeURLEncodedURIComponent(m[i]);
	      if (val !== undefined || !(hasOwnProperty.call(params, key.name))) {
	        params[key.name] = val;
	      }
	    }

	    return true;
	  };


	  /**
	   * Module exports.
	   */

	  var globalPage = createPage();
	  var page_js = globalPage;
	  var default_1 = globalPage;

	page_js.default = default_1;

	function writable(value, start = noop) {
		let stop;
		const subscribers = [];

		function set(new_value) {
			if (safe_not_equal(value, new_value)) {
				value = new_value;
				if (!stop) return; // not ready
				subscribers.forEach(s => s[1]());
				subscribers.forEach(s => s[0](value));
			}
		}

		function update(fn) {
			set(fn(value));
		}

		function subscribe(run, invalidate = noop) {
			const subscriber = [run, invalidate];
			subscribers.push(subscriber);
			if (subscribers.length === 1) stop = start(set) || noop;
			run(value);

			return () => {
				const index = subscribers.indexOf(subscriber);
				if (index !== -1) subscribers.splice(index, 1);
				if (subscribers.length === 0) stop();
			};
		}

		return { set, update, subscribe };
	}

	const gotrue = writable(null);
	const auth_response = writable(null);

	/* src/components/Nav.svelte generated by Svelte v3.1.0 */

	// (8:3) {:else}
	function create_else_block_1(ctx) {
		var li;

		return {
			c() {
				li = element("li");
				li.innerHTML = `<a href="/login">Log In</a>`;
			},

			m(target, anchor) {
				insert(target, li, anchor);
			},

			d(detaching) {
				if (detaching) {
					detach(li);
				}
			}
		};
	}

	// (5:3) {#if $auth_response}
	function create_if_block_1(ctx) {
		var li;

		return {
			c() {
				li = element("li");
				li.innerHTML = `<a href="/profile">Profile</a>`;
			},

			m(target, anchor) {
				insert(target, li, anchor);
			},

			d(detaching) {
				if (detaching) {
					detach(li);
				}
			}
		};
	}

	// (18:3) {:else}
	function create_else_block(ctx) {
		var li;

		return {
			c() {
				li = element("li");
				li.innerHTML = `<a href="/login">Log In</a>`;
			},

			m(target, anchor) {
				insert(target, li, anchor);
			},

			d(detaching) {
				if (detaching) {
					detach(li);
				}
			}
		};
	}

	// (15:3) {#if $auth_response}
	function create_if_block(ctx) {
		var li;

		return {
			c() {
				li = element("li");
				li.innerHTML = `<a href="/profile">Profile</a>`;
			},

			m(target, anchor) {
				insert(target, li, anchor);
			},

			d(detaching) {
				if (detaching) {
					detach(li);
				}
			}
		};
	}

	function create_fragment(ctx) {
		var nav, div, a0, t1, ul0, li0, t3, t4, ul1, li1, t6, t7, a3;

		function select_block_type(ctx) {
			if (ctx.$auth_response) return create_if_block_1;
			return create_else_block_1;
		}

		var current_block_type = select_block_type(ctx);
		var if_block0 = current_block_type(ctx);

		function select_block_type_1(ctx) {
			if (ctx.$auth_response) return create_if_block;
			return create_else_block;
		}

		var current_block_type_1 = select_block_type_1(ctx);
		var if_block1 = current_block_type_1(ctx);

		return {
			c() {
				nav = element("nav");
				div = element("div");
				a0 = element("a");
				a0.textContent = "Logo";
				t1 = space();
				ul0 = element("ul");
				li0 = element("li");
				li0.innerHTML = `<a href="/">Home</a>`;
				t3 = space();
				if_block0.c();
				t4 = space();
				ul1 = element("ul");
				li1 = element("li");
				li1.innerHTML = `<a href="/">Home</a>`;
				t6 = space();
				if_block1.c();
				t7 = space();
				a3 = element("a");
				a3.innerHTML = `<i class="material-icons">menu</i>`;
				a0.id = "logo-container";
				a0.href = "#";
				a0.className = "brand-logo";
				ul0.className = "right hide-on-med-and-down";
				ul1.id = "nav-mobile";
				ul1.className = "sidenav";
				a3.href = "#";
				a3.dataset.target = "nav-mobile";
				a3.className = "sidenav-trigger";
				div.className = "nav-wrapper container";
				nav.className = "teal lighten-1";
				attr(nav, "role", "navigation");
			},

			m(target, anchor) {
				insert(target, nav, anchor);
				append(nav, div);
				append(div, a0);
				append(div, t1);
				append(div, ul0);
				append(ul0, li0);
				append(ul0, t3);
				if_block0.m(ul0, null);
				append(div, t4);
				append(div, ul1);
				append(ul1, li1);
				append(ul1, t6);
				if_block1.m(ul1, null);
				append(div, t7);
				append(div, a3);
			},

			p(changed, ctx) {
				if (current_block_type !== (current_block_type = select_block_type(ctx))) {
					if_block0.d(1);
					if_block0 = current_block_type(ctx);
					if (if_block0) {
						if_block0.c();
						if_block0.m(ul0, null);
					}
				}

				if (current_block_type_1 !== (current_block_type_1 = select_block_type_1(ctx))) {
					if_block1.d(1);
					if_block1 = current_block_type_1(ctx);
					if (if_block1) {
						if_block1.c();
						if_block1.m(ul1, null);
					}
				}
			},

			i: noop,
			o: noop,

			d(detaching) {
				if (detaching) {
					detach(nav);
				}

				if_block0.d();
				if_block1.d();
			}
		};
	}

	function instance($$self, $$props, $$invalidate) {
		let $auth_response;

		subscribe($$self, auth_response, $$value => { $auth_response = $$value; $$invalidate('$auth_response', $auth_response); });

		return { $auth_response };
	}

	class Nav extends SvelteComponent {
		constructor(options) {
			super();
			init(this, options, instance, create_fragment, safe_not_equal, []);
		}
	}

	/* src/components/Hero.svelte generated by Svelte v3.1.0 */

	/* src/components/Footer.svelte generated by Svelte v3.1.0 */

	function create_fragment$1(ctx) {
		var footer;

		return {
			c() {
				footer = element("footer");
				footer.innerHTML = `<div class="container"><div class="row"><div class="col l6 s12"><h5 class="white-text">Company Bio</h5>
			          <p class="grey-text text-lighten-4">We are but poor lost circus performers. Is there a village nearby?</p></div>
			        <div class="col l3 s12"><h5 class="white-text">Connect</h5>
			          <ul><li><a class="white-text" href="https://twitter.com/bketelsen">Twitter: @bketelsen</a></li>
			            <li><a class="white-text" href="https://github.com/bketelsen">Github: bketelsen</a></li>
			            <li><a class="white-text" href="https://brian.dev">Web: brian.dev</a></li></ul></div></div></div>
			    <div class="footer-copyright"><div class="container">
			      Made by <a class="amber-text text-lighten-3" href="https://brian.dev">Brian Ketelsen</a></div></div>`;
				footer.className = "page-footer amber";
			},

			m(target, anchor) {
				insert(target, footer, anchor);
			},

			p: noop,
			i: noop,
			o: noop,

			d(detaching) {
				if (detaching) {
					detach(footer);
				}
			}
		};
	}

	class Footer extends SvelteComponent {
		constructor(options) {
			super();
			init(this, options, null, create_fragment$1, safe_not_equal, []);
		}
	}

	/* src/components/Summary.svelte generated by Svelte v3.1.0 */

	function create_fragment$2(ctx) {
		var article, span, t_value = ctx.course.name, t;

		return {
			c() {
				article = element("article");
				span = element("span");
				t = text(t_value);
			},

			m(target, anchor) {
				insert(target, article, anchor);
				append(article, span);
				append(span, t);
			},

			p(changed, ctx) {
				if ((changed.course) && t_value !== (t_value = ctx.course.name)) {
					set_data(t, t_value);
				}
			},

			i: noop,
			o: noop,

			d(detaching) {
				if (detaching) {
					detach(article);
				}
			}
		};
	}

	function instance$1($$self, $$props, $$invalidate) {
		let { course } = $$props;

		$$self.$set = $$props => {
			if ('course' in $$props) $$invalidate('course', course = $$props.course);
		};

		return { course };
	}

	class Summary extends SvelteComponent {
		constructor(options) {
			super();
			init(this, options, instance$1, create_fragment$2, safe_not_equal, ["course"]);
		}
	}

	/* src/components/List.svelte generated by Svelte v3.1.0 */

	function get_each_context(ctx, list, i) {
		const child_ctx = Object.create(ctx);
		child_ctx.course = list[i];
		child_ctx.each_value = list;
		child_ctx.i = i;
		return child_ctx;
	}

	// (6:0) {:else}
	function create_else_block$1(ctx) {
		var p;

		return {
			c() {
				p = element("p");
				p.textContent = "loading...";
				p.className = "loading";
			},

			m(target, anchor) {
				insert(target, p, anchor);
			},

			p: noop,
			i: noop,
			o: noop,

			d(detaching) {
				if (detaching) {
					detach(p);
				}
			}
		};
	}

	// (1:0) {#if courses}
	function create_if_block$1(ctx) {
		var each_1_anchor, current;

		var each_value = ctx.courses;

		var each_blocks = [];

		for (var i = 0; i < each_value.length; i += 1) {
			each_blocks[i] = create_each_block(get_each_context(ctx, each_value, i));
		}

		function outro_block(i, detaching, local) {
			if (each_blocks[i]) {
				if (detaching) {
					on_outro(() => {
						each_blocks[i].d(detaching);
						each_blocks[i] = null;
					});
				}

				each_blocks[i].o(local);
			}
		}

		return {
			c() {
				for (var i = 0; i < each_blocks.length; i += 1) {
					each_blocks[i].c();
				}

				each_1_anchor = empty();
			},

			m(target, anchor) {
				for (var i = 0; i < each_blocks.length; i += 1) {
					each_blocks[i].m(target, anchor);
				}

				insert(target, each_1_anchor, anchor);
				current = true;
			},

			p(changed, ctx) {
				if (changed.courses) {
					each_value = ctx.courses;

					for (var i = 0; i < each_value.length; i += 1) {
						const child_ctx = get_each_context(ctx, each_value, i);

						if (each_blocks[i]) {
							each_blocks[i].p(changed, child_ctx);
							each_blocks[i].i(1);
						} else {
							each_blocks[i] = create_each_block(child_ctx);
							each_blocks[i].c();
							each_blocks[i].i(1);
							each_blocks[i].m(each_1_anchor.parentNode, each_1_anchor);
						}
					}

					group_outros();
					for (; i < each_blocks.length; i += 1) outro_block(i, 1, 1);
					check_outros();
				}
			},

			i(local) {
				if (current) return;
				for (var i = 0; i < each_value.length; i += 1) each_blocks[i].i();

				current = true;
			},

			o(local) {
				each_blocks = each_blocks.filter(Boolean);
				for (let i = 0; i < each_blocks.length; i += 1) outro_block(i, 0);

				current = false;
			},

			d(detaching) {
				destroy_each(each_blocks, detaching);

				if (detaching) {
					detach(each_1_anchor);
				}
			}
		};
	}

	// (2:1) {#each courses as course, i}
	function create_each_block(ctx) {
		var updating_course, current;

		function summary_course_binding(value) {
			ctx.summary_course_binding.call(null, value, ctx);
			updating_course = true;
			add_flush_callback(() => updating_course = false);
		}

		let summary_props = {};
		if (ctx.course !== void 0) {
			summary_props.course = ctx.course;
		}
		var summary = new Summary({ props: summary_props });

		add_binding_callback(() => bind(summary, 'course', summary_course_binding));

		return {
			c() {
				summary.$$.fragment.c();
			},

			m(target, anchor) {
				mount_component(summary, target, anchor);
				current = true;
			},

			p(changed, new_ctx) {
				ctx = new_ctx;
				var summary_changes = {};
				if (!updating_course && changed.courses) {
					summary_changes.course = ctx.course;
				}
				summary.$set(summary_changes);
			},

			i(local) {
				if (current) return;
				summary.$$.fragment.i(local);

				current = true;
			},

			o(local) {
				summary.$$.fragment.o(local);
				current = false;
			},

			d(detaching) {
				summary.$destroy(detaching);
			}
		};
	}

	function create_fragment$3(ctx) {
		var current_block_type_index, if_block, if_block_anchor, current;

		var if_block_creators = [
			create_if_block$1,
			create_else_block$1
		];

		var if_blocks = [];

		function select_block_type(ctx) {
			if (ctx.courses) return 0;
			return 1;
		}

		current_block_type_index = select_block_type(ctx);
		if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);

		return {
			c() {
				if_block.c();
				if_block_anchor = empty();
			},

			m(target, anchor) {
				if_blocks[current_block_type_index].m(target, anchor);
				insert(target, if_block_anchor, anchor);
				current = true;
			},

			p(changed, ctx) {
				var previous_block_index = current_block_type_index;
				current_block_type_index = select_block_type(ctx);
				if (current_block_type_index === previous_block_index) {
					if_blocks[current_block_type_index].p(changed, ctx);
				} else {
					group_outros();
					on_outro(() => {
						if_blocks[previous_block_index].d(1);
						if_blocks[previous_block_index] = null;
					});
					if_block.o(1);
					check_outros();

					if_block = if_blocks[current_block_type_index];
					if (!if_block) {
						if_block = if_blocks[current_block_type_index] = if_block_creators[current_block_type_index](ctx);
						if_block.c();
					}
					if_block.i(1);
					if_block.m(if_block_anchor.parentNode, if_block_anchor);
				}
			},

			i(local) {
				if (current) return;
				if (if_block) if_block.i();
				current = true;
			},

			o(local) {
				if (if_block) if_block.o();
				current = false;
			},

			d(detaching) {
				if_blocks[current_block_type_index].d(detaching);

				if (detaching) {
					detach(if_block_anchor);
				}
			}
		};
	}

	function instance$2($$self, $$props, $$invalidate) {
		let { courses } = $$props;

		function summary_course_binding(value, { course, each_value, i }) {
			each_value[i] = value;
			$$invalidate('courses', courses);
		}

		$$self.$set = $$props => {
			if ('courses' in $$props) $$invalidate('courses', courses = $$props.courses);
		};

		return { courses, summary_course_binding };
	}

	class List extends SvelteComponent {
		constructor(options) {
			super();
			init(this, options, instance$2, create_fragment$3, safe_not_equal, ["courses"]);
		}
	}

	/* src/Home.svelte generated by Svelte v3.1.0 */

	// (13:3) {:else}
	function create_else_block$2(ctx) {
		var li;

		return {
			c() {
				li = element("li");
				li.innerHTML = `<a href="/login">Log In</a>`;
			},

			m(target, anchor) {
				insert(target, li, anchor);
			},

			d(detaching) {
				if (detaching) {
					detach(li);
				}
			}
		};
	}

	// (10:3) {#if $auth_response}
	function create_if_block$2(ctx) {
		var li;

		return {
			c() {
				li = element("li");
				li.innerHTML = `<a href="/project1">Project1</a>`;
			},

			m(target, anchor) {
				insert(target, li, anchor);
			},

			d(detaching) {
				if (detaching) {
					detach(li);
				}
			}
		};
	}

	function create_fragment$4(ctx) {
		var div1, div0, h1, t1, p, t3, ul, t4, updating_courses, t5, br0, br1, current;

		function select_block_type(ctx) {
			if (ctx.$auth_response) return create_if_block$2;
			return create_else_block$2;
		}

		var current_block_type = select_block_type(ctx);
		var if_block = current_block_type(ctx);

		function list_courses_binding(value) {
			ctx.list_courses_binding.call(null, value);
			updating_courses = true;
			add_flush_callback(() => updating_courses = false);
		}

		let list_props = {};
		if (ctx.courses !== void 0) {
			list_props.courses = ctx.courses;
		}
		var list = new List({ props: list_props });

		add_binding_callback(() => bind(list, 'courses', list_courses_binding));

		return {
			c() {
				div1 = element("div");
				div0 = element("div");
				h1 = element("h1");
				h1.textContent = "Learn SvelteJS v3";
				t1 = space();
				p = element("p");
				p.textContent = "Projects";
				t3 = space();
				ul = element("ul");
				if_block.c();
				t4 = space();
				list.$$.fragment.c();
				t5 = space();
				br0 = element("br");
				br1 = element("br");
				div0.className = "section";
				div1.className = "container";
			},

			m(target, anchor) {
				insert(target, div1, anchor);
				append(div1, div0);
				append(div0, h1);
				append(div0, t1);
				append(div0, p);
				append(div0, t3);
				append(div0, ul);
				if_block.m(ul, null);
				append(ul, t4);
				mount_component(list, ul, null);
				append(div1, t5);
				append(div1, br0);
				append(div1, br1);
				current = true;
			},

			p(changed, ctx) {
				if (current_block_type !== (current_block_type = select_block_type(ctx))) {
					if_block.d(1);
					if_block = current_block_type(ctx);
					if (if_block) {
						if_block.c();
						if_block.m(ul, t4);
					}
				}

				var list_changes = {};
				if (!updating_courses && changed.courses) {
					list_changes.courses = ctx.courses;
				}
				list.$set(list_changes);
			},

			i(local) {
				if (current) return;
				list.$$.fragment.i(local);

				current = true;
			},

			o(local) {
				list.$$.fragment.o(local);
				current = false;
			},

			d(detaching) {
				if (detaching) {
					detach(div1);
				}

				if_block.d();

				list.$destroy();
			}
		};
	}

	function instance$3($$self, $$props, $$invalidate) {
		let $auth_response;

		subscribe($$self, auth_response, $$value => { $auth_response = $$value; $$invalidate('$auth_response', $auth_response); });

		
		let courses;
		async function getdata() {
			$$invalidate('courses', courses = await fetch(`/courses/courses.json`).then(r => r.json()));
			console.log(courses[0].name);
		}

		onMount(getdata);

		function list_courses_binding(value) {
			courses = value;
			$$invalidate('courses', courses);
		}

		return {
			courses,
			$auth_response,
			list_courses_binding
		};
	}

	class Home extends SvelteComponent {
		constructor(options) {
			super();
			init(this, options, instance$3, create_fragment$4, safe_not_equal, []);
		}
	}

	/* src/Login.svelte generated by Svelte v3.1.0 */

	function create_fragment$5(ctx) {
		var div2, div1, h1, t1, ul, t3, div0, input0, br0, t4, input1, t5, button, t7, br1, br2, dispose;

		return {
			c() {
				div2 = element("div");
				div1 = element("div");
				h1 = element("h1");
				h1.textContent = "Login";
				t1 = space();
				ul = element("ul");
				ul.innerHTML = `<li><a href="/">Home</a></li>`;
				t3 = space();
				div0 = element("div");
				input0 = element("input");
				br0 = element("br");
				t4 = space();
				input1 = element("input");
				t5 = space();
				button = element("button");
				button.textContent = "Login";
				t7 = space();
				br1 = element("br");
				br2 = element("br");
				attr(input1, "type", "password");
				div1.className = "section";
				div2.className = "container";

				dispose = [
					listen(input0, "input", ctx.input0_input_handler),
					listen(input1, "input", ctx.input1_input_handler),
					listen(button, "click", ctx.loginClick)
				];
			},

			m(target, anchor) {
				insert(target, div2, anchor);
				append(div2, div1);
				append(div1, h1);
				append(div1, t1);
				append(div1, ul);
				append(div1, t3);
				append(div1, div0);
				append(div0, input0);

				input0.value = ctx.user_email;

				append(div0, br0);
				append(div0, t4);
				append(div0, input1);

				input1.value = ctx.user_password;

				append(div0, t5);
				append(div0, button);
				append(div2, t7);
				append(div2, br1);
				append(div2, br2);
			},

			p(changed, ctx) {
				if (changed.user_email && (input0.value !== ctx.user_email)) input0.value = ctx.user_email;
				if (changed.user_password) input1.value = ctx.user_password;
			},

			i: noop,
			o: noop,

			d(detaching) {
				if (detaching) {
					detach(div2);
				}

				run_all(dispose);
			}
		};
	}

	function instance$4($$self, $$props, $$invalidate) {
		let $gotrue;

		subscribe($$self, gotrue, $$value => { $gotrue = $$value; $$invalidate('$gotrue', $gotrue); });

		
		let user_email = '';
		let user_password = '';


		function loginClick() {
			$gotrue	
				.login(user_email, user_password)
				.then(response => {
					alert("Success! Response: " + JSON.stringify({ response }));
					auth_response.set(response);
	    			page_js.redirect('/');
				})
				.catch(error => alert("Failed :( " + JSON.stringify(error)));
		}

		function input0_input_handler() {
			user_email = this.value;
			$$invalidate('user_email', user_email);
		}

		function input1_input_handler() {
			user_password = this.value;
			$$invalidate('user_password', user_password);
		}

		return {
			user_email,
			user_password,
			loginClick,
			input0_input_handler,
			input1_input_handler
		};
	}

	class Login extends SvelteComponent {
		constructor(options) {
			super();
			init(this, options, instance$4, create_fragment$5, safe_not_equal, []);
		}
	}

	/* src/project1/Index.svelte generated by Svelte v3.1.0 */

	function create_fragment$6(ctx) {
		var div1, div0, h1, t1, p, t2, t3_value = ctx.$auth_response.email, t3, t4, ul, t6, a1, t8, a2, t11, a3, t14, br0, br1;

		return {
			c() {
				div1 = element("div");
				div0 = element("div");
				h1 = element("h1");
				h1.textContent = "Project 1";
				t1 = space();
				p = element("p");
				t2 = text("Projects for ");
				t3 = text(t3_value);
				t4 = space();
				ul = element("ul");
				ul.innerHTML = `<li><a href="/">Home</a></li>`;
				t6 = space();
				a1 = element("a");
				a1.textContent = "button";
				t8 = space();
				a2 = element("a");
				a2.innerHTML = `<i class="material-icons left">cloud</i>early clouds`;
				t11 = space();
				a3 = element("a");
				a3.innerHTML = `<i class="material-icons right">cloud</i>late clouds`;
				t14 = space();
				br0 = element("br");
				br1 = element("br");
				a1.className = "waves-effect waves-light btn";
				a2.className = "waves-effect waves-light btn";
				a3.className = "waves-effect waves-light btn";
				div0.className = "section";
				div1.className = "container";
			},

			m(target, anchor) {
				insert(target, div1, anchor);
				append(div1, div0);
				append(div0, h1);
				append(div0, t1);
				append(div0, p);
				append(p, t2);
				append(p, t3);
				append(div0, t4);
				append(div0, ul);
				append(div0, t6);
				append(div0, a1);
				append(div0, t8);
				append(div0, a2);
				append(div0, t11);
				append(div0, a3);
				append(div1, t14);
				append(div1, br0);
				append(div1, br1);
			},

			p(changed, ctx) {
				if ((changed.$auth_response) && t3_value !== (t3_value = ctx.$auth_response.email)) {
					set_data(t3, t3_value);
				}
			},

			i: noop,
			o: noop,

			d(detaching) {
				if (detaching) {
					detach(div1);
				}
			}
		};
	}

	function instance$5($$self, $$props, $$invalidate) {
		let $auth_response;

		subscribe($$self, auth_response, $$value => { $auth_response = $$value; $$invalidate('$auth_response', $auth_response); });

		return { $auth_response };
	}

	class Index extends SvelteComponent {
		constructor(options) {
			super();
			init(this, options, instance$5, create_fragment$6, safe_not_equal, []);
		}
	}

	function unwrapExports (x) {
		return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, 'default') ? x['default'] : x;
	}

	function createCommonjsModule(fn, module) {
		return module = { exports: {} }, fn(module, module.exports), module.exports;
	}

	var pagination = createCommonjsModule(function (module, exports) {

	Object.defineProperty(exports, "__esModule", {
	  value: true
	});

	var _slicedToArray = function () { function sliceIterator(arr, i) { var _arr = []; var _n = true; var _d = false; var _e = undefined; try { for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i["return"]) _i["return"](); } finally { if (_d) throw _e; } } return _arr; } return function (arr, i) { if (Array.isArray(arr)) { return arr; } else if (Symbol.iterator in Object(arr)) { return sliceIterator(arr, i); } else { throw new TypeError("Invalid attempt to destructure non-iterable instance"); } }; }();

	exports.getPagination = getPagination;
	function getPagination(response) {
	  var links = response.headers.get("Link");
	  var pagination = {};
	  //var link, url, rel, m, page;
	  if (links == null) {
	    return null;
	  }
	  links = links.split(",");
	  var total = response.headers.get("X-Total-Count");

	  for (var i = 0, len = links.length; i < len; i++) {
	    var link = links[i].replace(/(^\s*|\s*$)/, "");

	    var _link$split = link.split(";"),
	        _link$split2 = _slicedToArray(_link$split, 2),
	        url = _link$split2[0],
	        rel = _link$split2[1];

	    var m = url.match(/page=(\d+)/);
	    var page = m && parseInt(m[1], 10);
	    if (rel.match(/last/)) {
	      pagination.last = page;
	    } else if (rel.match(/next/)) {
	      pagination.next = page;
	    } else if (rel.match(/prev/)) {
	      pagination.prev = page;
	    } else if (rel.match(/first/)) {
	      pagination.first = page;
	    }
	  }

	  pagination.last = Math.max(pagination.last || 0, pagination.prev && pagination.prev + 1 || 0);
	  pagination.current = pagination.next ? pagination.next - 1 : pagination.last || 1;
	  pagination.total = total ? parseInt(total, 10) : null;

	  return pagination;
	}
	});

	unwrapExports(pagination);
	var pagination_1 = pagination.getPagination;

	var lib = createCommonjsModule(function (module, exports) {

	Object.defineProperty(exports, "__esModule", {
	  value: true
	});
	exports.JSONHTTPError = exports.TextHTTPError = exports.HTTPError = exports.getPagination = undefined;

	var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

	var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();



	Object.defineProperty(exports, "getPagination", {
	  enumerable: true,
	  get: function get() {
	    return pagination.getPagination;
	  }
	});

	function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

	function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

	function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

	function _extendableBuiltin(cls) {
	  function ExtendableBuiltin() {
	    var instance = Reflect.construct(cls, Array.from(arguments));
	    Object.setPrototypeOf(instance, Object.getPrototypeOf(this));
	    return instance;
	  }

	  ExtendableBuiltin.prototype = Object.create(cls.prototype, {
	    constructor: {
	      value: cls,
	      enumerable: false,
	      writable: true,
	      configurable: true
	    }
	  });

	  if (Object.setPrototypeOf) {
	    Object.setPrototypeOf(ExtendableBuiltin, cls);
	  } else {
	    ExtendableBuiltin.__proto__ = cls;
	  }

	  return ExtendableBuiltin;
	}

	var HTTPError = exports.HTTPError = function (_extendableBuiltin2) {
	  _inherits(HTTPError, _extendableBuiltin2);

	  function HTTPError(response) {
	    _classCallCheck(this, HTTPError);

	    var _this = _possibleConstructorReturn(this, (HTTPError.__proto__ || Object.getPrototypeOf(HTTPError)).call(this, response.statusText));

	    _this.name = _this.constructor.name;
	    if (typeof Error.captureStackTrace === "function") {
	      Error.captureStackTrace(_this, _this.constructor);
	    } else {
	      _this.stack = new Error(response.statusText).stack;
	    }
	    _this.status = response.status;
	    return _this;
	  }

	  return HTTPError;
	}(_extendableBuiltin(Error));

	var TextHTTPError = exports.TextHTTPError = function (_HTTPError) {
	  _inherits(TextHTTPError, _HTTPError);

	  function TextHTTPError(response, data) {
	    _classCallCheck(this, TextHTTPError);

	    var _this2 = _possibleConstructorReturn(this, (TextHTTPError.__proto__ || Object.getPrototypeOf(TextHTTPError)).call(this, response));

	    _this2.data = data;
	    return _this2;
	  }

	  return TextHTTPError;
	}(HTTPError);

	var JSONHTTPError = exports.JSONHTTPError = function (_HTTPError2) {
	  _inherits(JSONHTTPError, _HTTPError2);

	  function JSONHTTPError(response, json) {
	    _classCallCheck(this, JSONHTTPError);

	    var _this3 = _possibleConstructorReturn(this, (JSONHTTPError.__proto__ || Object.getPrototypeOf(JSONHTTPError)).call(this, response));

	    _this3.json = json;
	    return _this3;
	  }

	  return JSONHTTPError;
	}(HTTPError);

	var API = function () {
	  function API() {
	    var apiURL = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : '';
	    var options = arguments[1];

	    _classCallCheck(this, API);

	    this.apiURL = apiURL;
	    if (this.apiURL.match(/\/[^\/]?/)) {
	      // eslint-disable-line no-useless-escape
	      this._sameOrigin = true;
	    }
	    this.defaultHeaders = options && options.defaultHeaders || {};
	  }

	  _createClass(API, [{
	    key: "headers",
	    value: function headers() {
	      var _headers = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {};

	      return _extends({}, this.defaultHeaders, {
	        "Content-Type": "application/json"
	      }, _headers);
	    }
	  }, {
	    key: "parseJsonResponse",
	    value: function parseJsonResponse(response) {
	      return response.json().then(function (json) {
	        if (!response.ok) {
	          return Promise.reject(new JSONHTTPError(response, json));
	        }

	        var pagination$1 = (0, pagination.getPagination)(response);
	        return pagination$1 ? { pagination: pagination$1, items: json } : json;
	      });
	    }
	  }, {
	    key: "request",
	    value: function request(path) {
	      var _this4 = this;

	      var options = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

	      var headers = this.headers(options.headers || {});
	      if (this._sameOrigin) {
	        options.credentials = options.credentials || "same-origin";
	      }
	      return fetch(this.apiURL + path, _extends({}, options, { headers: headers })).then(function (response) {
	        var contentType = response.headers.get("Content-Type");
	        if (contentType && contentType.match(/json/)) {
	          return _this4.parseJsonResponse(response);
	        }

	        if (!response.ok) {
	          return response.text().then(function (data) {
	            return Promise.reject(new TextHTTPError(response, data));
	          });
	        }
	        return response.text().then(function (data) {
	        });
	      });
	    }
	  }]);

	  return API;
	}();

	exports.default = API;
	});

	unwrapExports(lib);
	var lib_1 = lib.JSONHTTPError;
	var lib_2 = lib.TextHTTPError;
	var lib_3 = lib.HTTPError;
	var lib_4 = lib.getPagination;

	var admin = createCommonjsModule(function (module, exports) {

	Object.defineProperty(exports, "__esModule", {
	  value: true
	});

	var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

	function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

	var Admin = function () {
	  function Admin(user) {
	    _classCallCheck(this, Admin);

	    this.user = user;
	  }

	  // Return a list of all users in an audience


	  _createClass(Admin, [{
	    key: "listUsers",
	    value: function listUsers(aud) {
	      return this.user._request("/admin/users", {
	        method: "GET",
	        audience: aud
	      });
	    }
	  }, {
	    key: "getUser",
	    value: function getUser(user) {
	      return this.user._request("/admin/users/" + user.id);
	    }
	  }, {
	    key: "updateUser",
	    value: function updateUser(user) {
	      var attributes = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

	      return this.user._request("/admin/users/" + user.id, {
	        method: "PUT",
	        body: JSON.stringify(attributes)
	      });
	    }
	  }, {
	    key: "createUser",
	    value: function createUser(email, password) {
	      var attributes = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : {};

	      attributes.email = email;
	      attributes.password = password;
	      return this.user._request("/admin/users", {
	        method: "POST",
	        body: JSON.stringify(attributes)
	      });
	    }
	  }, {
	    key: "deleteUser",
	    value: function deleteUser(user) {
	      return this.user._request("/admin/users/" + user.id, {
	        method: "DELETE"
	      });
	    }
	  }]);

	  return Admin;
	}();

	exports.default = Admin;
	});

	unwrapExports(admin);

	var user = createCommonjsModule(function (module, exports) {

	Object.defineProperty(exports, "__esModule", {
	  value: true
	});

	var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

	var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();



	var _microApiClient2 = _interopRequireDefault(lib);



	var _admin2 = _interopRequireDefault(admin);

	function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

	function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

	var ExpiryMargin = 60 * 1000;
	var storageKey = "gotrue.user";
	var refreshPromises = {};
	var currentUser = null;
	var forbiddenUpdateAttributes = { api: 1, token: 1, audience: 1, url: 1 };
	var forbiddenSaveAttributes = { api: 1 };
	var isBrowser = function isBrowser() {
	  return typeof window !== "undefined";
	};

	var User = function () {
	  function User(api, tokenResponse, audience) {
	    _classCallCheck(this, User);

	    this.api = api;
	    this.url = api.apiURL;
	    this.audience = audience;
	    this._processTokenResponse(tokenResponse);
	    currentUser = this;
	  }

	  _createClass(User, [{
	    key: "update",
	    value: function update(attributes) {
	      var _this = this;

	      return this._request("/user", {
	        method: "PUT",
	        body: JSON.stringify(attributes)
	      }).then(function (response) {
	        return _this._saveUserData(response)._refreshSavedSession();
	      });
	    }
	  }, {
	    key: "jwt",
	    value: function jwt(forceRefresh) {
	      var _tokenDetails = this.tokenDetails(),
	          expires_at = _tokenDetails.expires_at,
	          refresh_token = _tokenDetails.refresh_token,
	          access_token = _tokenDetails.access_token;

	      if (forceRefresh || expires_at - ExpiryMargin < Date.now()) {
	        return this._refreshToken(refresh_token);
	      }
	      return Promise.resolve(access_token);
	    }
	  }, {
	    key: "logout",
	    value: function logout() {
	      return this._request("/logout", { method: "POST" }).then(this.clearSession.bind(this)).catch(this.clearSession.bind(this));
	    }
	  }, {
	    key: "_refreshToken",
	    value: function _refreshToken(refresh_token) {
	      var _this2 = this;

	      if (refreshPromises[refresh_token]) {
	        return refreshPromises[refresh_token];
	      }
	      return refreshPromises[refresh_token] = this.api.request("/token", {
	        method: "POST",
	        headers: { "Content-Type": "application/x-www-form-urlencoded" },
	        body: "grant_type=refresh_token&refresh_token=" + refresh_token
	      }).then(function (response) {
	        delete refreshPromises[refresh_token];
	        _this2._processTokenResponse(response);
	        _this2._refreshSavedSession();
	        return _this2.token.access_token;
	      }).catch(function (error) {
	        delete refreshPromises[refresh_token];
	        _this2.clearSession();
	        return Promise.reject(error);
	      });
	    }
	  }, {
	    key: "_request",
	    value: function _request(path) {
	      var _this3 = this;

	      var options = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

	      options.headers = options.headers || {};

	      var aud = options.audience || this.audience;
	      if (aud) {
	        options.headers["X-JWT-AUD"] = aud;
	      }

	      return this.jwt().then(function (token) {
	        return _this3.api.request(path, _extends({
	          headers: Object.assign(options.headers, {
	            Authorization: "Bearer " + token
	          })
	        }, options)).catch(function (err) {
	          if (err instanceof lib.JSONHTTPError && err.json) {
	            if (err.json.msg) {
	              err.message = err.json.msg;
	            } else if (err.json.error) {
	              err.message = err.json.error + ": " + err.json.error_description;
	            }
	          }
	          return Promise.reject(err);
	        });
	      });
	    }
	  }, {
	    key: "getUserData",
	    value: function getUserData() {
	      return this._request("/user").then(this._saveUserData.bind(this)).then(this._refreshSavedSession.bind(this));
	    }
	  }, {
	    key: "_saveUserData",
	    value: function _saveUserData(attributes, fromStorage) {
	      for (var key in attributes) {
	        if (key in User.prototype || key in forbiddenUpdateAttributes) {
	          continue;
	        }
	        this[key] = attributes[key];
	      }
	      if (fromStorage) {
	        this._fromStorage = true;
	      }
	      return this;
	    }
	  }, {
	    key: "_processTokenResponse",
	    value: function _processTokenResponse(tokenResponse) {
	      this.token = tokenResponse;
	      var claims = void 0;
	      try {
	        claims = JSON.parse(urlBase64Decode(tokenResponse.access_token.split(".")[1]));
	        this.token.expires_at = claims.exp * 1000;
	      } catch (e) {
	        console.error(new Error("Gotrue-js: Failed to parse tokenResponse claims: " + JSON.stringify(tokenResponse)));
	      }
	    }
	  }, {
	    key: "_refreshSavedSession",
	    value: function _refreshSavedSession() {
	      // only update saved session if we previously saved something
	      if (isBrowser() && localStorage.getItem(storageKey)) {
	        this._saveSession();
	      }
	      return this;
	    }
	  }, {
	    key: "_saveSession",
	    value: function _saveSession() {
	      isBrowser() && localStorage.setItem(storageKey, JSON.stringify(this._details));
	      return this;
	    }
	  }, {
	    key: "tokenDetails",
	    value: function tokenDetails() {
	      return this.token;
	    }
	  }, {
	    key: "clearSession",
	    value: function clearSession() {
	      User.removeSavedSession();
	      this.token = null;
	      currentUser = null;
	    }
	  }, {
	    key: "admin",
	    get: function get() {
	      return new _admin2.default(this);
	    }
	  }, {
	    key: "_details",
	    get: function get() {
	      var userCopy = {};
	      for (var key in this) {
	        if (key in User.prototype || key in forbiddenSaveAttributes) {
	          continue;
	        }
	        userCopy[key] = this[key];
	      }
	      return userCopy;
	    }
	  }], [{
	    key: "removeSavedSession",
	    value: function removeSavedSession() {
	      isBrowser() && localStorage.removeItem(storageKey);
	    }
	  }, {
	    key: "recoverSession",
	    value: function recoverSession(apiInstance) {
	      if (currentUser) {
	        return currentUser;
	      }

	      var json = isBrowser() && localStorage.getItem(storageKey);
	      if (json) {
	        try {
	          var data = JSON.parse(json);
	          var url = data.url,
	              token = data.token,
	              audience = data.audience;

	          if (!url || !token) {
	            return null;
	          }

	          var api = apiInstance || new _microApiClient2.default(url, {});
	          return new User(api, token, audience)._saveUserData(data, true);
	        } catch (ex) {
	          console.error(new Error("Gotrue-js: Error recovering session: " + ex));
	          return null;
	        }
	      }

	      return null;
	    }
	  }]);

	  return User;
	}();

	exports.default = User;


	function urlBase64Decode(str) {
	  // From https://jwt.io/js/jwt.js
	  var output = str.replace(/-/g, '+').replace(/_/g, '/');
	  switch (output.length % 4) {
	    case 0:
	      break;
	    case 2:
	      output += '==';
	      break;
	    case 3:
	      output += '=';
	      break;
	    default:
	      throw 'Illegal base64url string!';
	  }
	  var result = window.atob(output); //polifyll https://github.com/davidchambers/Base64.js
	  try {
	    return decodeURIComponent(escape(result));
	  } catch (err) {
	    return result;
	  }
	}
	});

	unwrapExports(user);

	var lib$1 = createCommonjsModule(function (module, exports) {

	Object.defineProperty(exports, "__esModule", {
	  value: true
	});

	var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();



	var _microApiClient2 = _interopRequireDefault(lib);



	var _user2 = _interopRequireDefault(user);

	function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

	function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

	var HTTPRegexp = /^http:\/\//;
	var defaultApiURL = "/.netlify/identity";

	var GoTrue = function () {
	  function GoTrue() {
	    var _ref = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : {},
	        _ref$APIUrl = _ref.APIUrl,
	        APIUrl = _ref$APIUrl === undefined ? defaultApiURL : _ref$APIUrl,
	        _ref$audience = _ref.audience,
	        audience = _ref$audience === undefined ? "" : _ref$audience,
	        _ref$setCookie = _ref.setCookie,
	        setCookie = _ref$setCookie === undefined ? false : _ref$setCookie;

	    _classCallCheck(this, GoTrue);

	    if (APIUrl.match(HTTPRegexp)) {
	      console.warn("Warning:\n\nDO NOT USE HTTP IN PRODUCTION FOR GOTRUE EVER!\nGoTrue REQUIRES HTTPS to work securely.");
	    }

	    if (audience) {
	      this.audience = audience;
	    }

	    this.setCookie = setCookie;

	    this.api = new _microApiClient2.default(APIUrl);
	  }

	  _createClass(GoTrue, [{
	    key: "_request",
	    value: function _request(path) {
	      var options = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};

	      options.headers = options.headers || {};
	      var aud = options.audience || this.audience;
	      if (aud) {
	        options.headers["X-JWT-AUD"] = aud;
	      }
	      return this.api.request(path, options).catch(function (err) {
	        if (err instanceof lib.JSONHTTPError && err.json) {
	          if (err.json.msg) {
	            err.message = err.json.msg;
	          } else if (err.json.error) {
	            err.message = err.json.error + ": " + err.json.error_description;
	          }
	        }
	        return Promise.reject(err);
	      });
	    }
	  }, {
	    key: "settings",
	    value: function settings() {
	      return this._request("/settings");
	    }
	  }, {
	    key: "signup",
	    value: function signup(email, password, data) {
	      return this._request("/signup", {
	        method: "POST",
	        body: JSON.stringify({ email: email, password: password, data: data })
	      });
	    }
	  }, {
	    key: "login",
	    value: function login(email, password, remember) {
	      var _this = this;

	      this._setRememberHeaders(remember);
	      return this._request("/token", {
	        method: "POST",
	        headers: { "Content-Type": "application/x-www-form-urlencoded" },
	        body: "grant_type=password&username=" + encodeURIComponent(email) + "&password=" + encodeURIComponent(password)
	      }).then(function (response) {
	        _user2.default.removeSavedSession();
	        return _this.createUser(response, remember);
	      });
	    }
	  }, {
	    key: "loginExternalUrl",
	    value: function loginExternalUrl(provider) {
	      return this.api.apiURL + "/authorize?provider=" + provider;
	    }
	  }, {
	    key: "confirm",
	    value: function confirm(token, remember) {
	      this._setRememberHeaders(remember);
	      return this.verify("signup", token, remember);
	    }
	  }, {
	    key: "requestPasswordRecovery",
	    value: function requestPasswordRecovery(email) {
	      return this._request("/recover", {
	        method: "POST",
	        body: JSON.stringify({ email: email })
	      });
	    }
	  }, {
	    key: "recover",
	    value: function recover(token, remember) {
	      this._setRememberHeaders(remember);
	      return this.verify("recovery", token, remember);
	    }
	  }, {
	    key: "acceptInvite",
	    value: function acceptInvite(token, password, remember) {
	      var _this2 = this;

	      this._setRememberHeaders(remember);
	      return this._request("/verify", {
	        method: "POST",
	        body: JSON.stringify({ token: token, password: password, type: "signup" })
	      }).then(function (response) {
	        return _this2.createUser(response, remember);
	      });
	    }
	  }, {
	    key: "acceptInviteExternalUrl",
	    value: function acceptInviteExternalUrl(provider, token) {
	      return this.api.apiURL + "/authorize?provider=" + provider + "&invite_token=" + token;
	    }
	  }, {
	    key: "createUser",
	    value: function createUser(tokenResponse) {
	      var remember = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : false;

	      this._setRememberHeaders(remember);
	      var user = new _user2.default(this.api, tokenResponse, this.audience);
	      return user.getUserData().then(function (user) {
	        if (remember) {
	          user._saveSession();
	        }
	        return user;
	      });
	    }
	  }, {
	    key: "currentUser",
	    value: function currentUser() {
	      var user = _user2.default.recoverSession(this.api);
	      user && this._setRememberHeaders(user._fromStorage);
	      return user;
	    }
	  }, {
	    key: "verify",
	    value: function verify(type, token, remember) {
	      var _this3 = this;

	      this._setRememberHeaders(remember);
	      return this._request("/verify", {
	        method: "POST",
	        body: JSON.stringify({ token: token, type: type })
	      }).then(function (response) {
	        return _this3.createUser(response, remember);
	      });
	    }
	  }, {
	    key: "_setRememberHeaders",
	    value: function _setRememberHeaders(remember) {
	      if (this.setCookie) {
	        this.api.defaultHeaders = this.api.defaultHeaders || {};
	        this.api.defaultHeaders["X-Use-Cookie"] = remember ? "1" : "session";
	      }
	    }
	  }]);

	  return GoTrue;
	}();

	exports.default = GoTrue;


	if (typeof window !== "undefined") {
	  window.GoTrue = GoTrue;
	}
	});

	var GoTrue = unwrapExports(lib$1);

	/* src/App.svelte generated by Svelte v3.1.0 */

	function create_fragment$7(ctx) {
		var main, t0, t1, current;

		var nav = new Nav({});

		var switch_value = ctx.page;

		function switch_props(ctx) {
			return {};
		}

		if (switch_value) {
			var switch_instance = new switch_value(switch_props(ctx));
		}

		var footer = new Footer({});

		return {
			c() {
				main = element("main");
				nav.$$.fragment.c();
				t0 = space();
				if (switch_instance) switch_instance.$$.fragment.c();
				t1 = space();
				footer.$$.fragment.c();
			},

			m(target, anchor) {
				insert(target, main, anchor);
				mount_component(nav, main, null);
				append(main, t0);

				if (switch_instance) {
					mount_component(switch_instance, main, null);
				}

				insert(target, t1, anchor);
				mount_component(footer, target, anchor);
				current = true;
			},

			p(changed, ctx) {
				if (switch_value !== (switch_value = ctx.page)) {
					if (switch_instance) {
						group_outros();
						const old_component = switch_instance;
						on_outro(() => {
							old_component.$destroy();
						});
						old_component.$$.fragment.o(1);
						check_outros();
					}

					if (switch_value) {
						switch_instance = new switch_value(switch_props(ctx));

						switch_instance.$$.fragment.c();
						switch_instance.$$.fragment.i(1);
						mount_component(switch_instance, main, null);
					} else {
						switch_instance = null;
					}
				}
			},

			i(local) {
				if (current) return;
				nav.$$.fragment.i(local);

				if (switch_instance) switch_instance.$$.fragment.i(local);

				footer.$$.fragment.i(local);

				current = true;
			},

			o(local) {
				nav.$$.fragment.o(local);
				if (switch_instance) switch_instance.$$.fragment.o(local);
				footer.$$.fragment.o(local);
				current = false;
			},

			d(detaching) {
				if (detaching) {
					detach(main);
				}

				nav.$destroy();

				if (switch_instance) switch_instance.$destroy();

				if (detaching) {
					detach(t1);
				}

				footer.$destroy(detaching);
			}
		};
	}

	function isEmpty(obj) {
	  for (var key in obj) {
	    if (obj.hasOwnProperty(key)) return false;
	  }
	  return true;
	}

	function instance$6($$self, $$props, $$invalidate) {
		let $auth_response;

		subscribe($$self, auth_response, $$value => { $auth_response = $$value; $$invalidate('$auth_response', $auth_response); });

		

	  function checkAuth(ctx, next) {
	    if (!isEmpty($auth_response)) {
	      next();
	    } else {
	      console.log("redirect no login");
	      console.log($auth_response);
	      page_js.redirect("/login");
	    }
	  }

	  const auth = new GoTrue({
	    APIUrl: "http://127.0.0.1:9999",
	    audience: "",
	    setCookie: false
	  });

	  gotrue.set(auth);

	  let page = Home;

	  page_js("/", () => { const $$result = (page = Home); $$invalidate('page', page); return $$result; });
	  page_js("/login", () => { const $$result = (page = Login); $$invalidate('page', page); return $$result; });
	  page_js("/project1", checkAuth, () => { const $$result = (page = Index); $$invalidate('page', page); return $$result; });

	  page_js.start();

		return { page };
	}

	class App extends SvelteComponent {
		constructor(options) {
			super();
			init(this, options, instance$6, create_fragment$7, safe_not_equal, []);
		}
	}

	const app = new App({
	    target: document.body,
	    props: {
	        name: 'GopherSnacks'
	    }
	});

	return app;

}());

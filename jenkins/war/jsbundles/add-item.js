/******/ (function() { // webpackBootstrap
/******/ 	var __webpack_modules__ = ({

/***/ 4461:
/***/ (function() {

"use strict";

;// ./src/main/js/util/i18n.js
function getI18n(text) {
  const i18n = document.querySelector("#i18n");
  return i18n.getAttribute("data-" + text);
}
;// ./src/main/js/util/dom.js
function createElementFromHtml(html) {
  const template = document.createElement("template");
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}
function toId(string) {
  const trimmed = string.trim();
  return Array.from(trimmed).map(c => c.codePointAt(0).toString(16)).join("-");
}
;// ./src/main/js/add-item.js


const enableHeadings = false;
const nameInput = document.querySelector(`#createItem input[name="name"]`);
const copyFromInput = document.querySelector(`#createItem input[name="from"]`);
const copyRadio = document.querySelector(`#createItem input[value="copy"]`);
const getItems = function () {
  return fetch("itemCategories?depth=3&iconStyle=icon-xlg").then(response => response.json());
};
const jRoot = document.querySelector("head").getAttribute("data-rooturl");
document.addEventListener("DOMContentLoaded", () => {
  getItems().then(data => {
    //////////////////////////
    // helper functions...

    function parseResponseFromCheckJobName(data) {
      var parser = new DOMParser();
      var html = parser.parseFromString(data, "text/html");
      var element = html.body.firstChild;
      if (element) {
        return element.textContent;
      }
      return undefined;
    }
    function cleanClassName(className) {
      return className.replace(/\./g, "_");
    }
    function checkForLink(desc) {
      if (desc.indexOf('&lt;a href="') === -1) {
        return desc;
      }
      // eslint-disable-next-line no-useless-escape
      var newDesc = desc.replace(/\&lt;/g, "<").replace(/\&gt;/g, ">");
      return newDesc;
    }
    function getCopyFromValue() {
      return copyFromInput.value;
    }
    function isItemNameEmpty() {
      var itemName = nameInput.value;
      return itemName.trim() === "";
    }
    function getFieldValidationStatus(fieldId) {
      return document.querySelector("#" + fieldId)?.dataset.valid === "true";
    }
    function setFieldValidationStatus(fieldId, status) {
      const element = document.querySelector("#" + fieldId);
      if (element) {
        element.dataset.valid = status;
      }
    }

    /**
     * Shows or clears the validation message for the name input.
     *
     * Only updates the UI after the user has interacted with the input, which is
     * indicated by `nameInput.dataset.dirty` being set.
     */
    function activateValidationMessage(message) {
      if (!nameInput.dataset.dirty) {
        return;
      }
      updateValidationArea(document.querySelector(".validation-error-area"), message !== undefined && message !== "" ? `<div class="error">${message}</div>` : `<div/>`);
      refreshSubmitButtonState();
    }
    function refreshSubmitButtonState() {
      const submitButton = document.querySelector(".bottom-sticker-inner button[type=submit]");
      submitButton.disabled = !getFormValidationStatus();
    }
    function getFormValidationStatus() {
      if (getFieldValidationStatus("name") && (getFieldValidationStatus("items") || getFieldValidationStatus("from"))) {
        return true;
      }
      return false;
    }
    function cleanItemSelection() {
      document.querySelector('#createItem input[type="radio"][name="mode"]').removeAttribute("checked");
      setFieldValidationStatus("items", false);
    }
    function cleanCopyFromOption() {
      copyRadio?.removeAttribute("checked");
      if (copyFromInput) {
        copyFromInput.value = "";
      }
      setFieldValidationStatus("from", false);
    }

    //////////////////////////////////
    // Draw functions

    function drawCategory(category) {
      const heading = createElementFromHtml("<div class='jenkins-choice-list__heading'></div>");
      const title = createElementFromHtml("<h2>" + category.name + "</h2>");
      const description = createElementFromHtml("<p>" + category.description + "</p>");
      heading.appendChild(title);
      heading.appendChild(description);
      const response = [];
      if (enableHeadings) {
        response.push(heading);
      }
      category.items.forEach(elem => {
        response.push(drawItem(elem));
      });
      return response;
    }
    function drawItem(elem) {
      var item = document.createElement("div");
      item.className = cleanClassName(elem.class) + " jenkins-choice-list__item";
      var label = item.appendChild(document.createElement("label"));
      var iconDiv = drawIcon(elem);
      label.appendChild(iconDiv);
      var radio = label.appendChild(document.createElement("input"));
      radio.type = "radio";
      radio.name = "mode";
      radio.value = elem.class;
      var displayName = label.appendChild(document.createElement("span"));
      displayName.className = "jenkins-choice-list__item__label";
      displayName.appendChild(document.createTextNode(elem.displayName));
      var desc = label.appendChild(document.createElement("div"));
      desc.className = "jenkins-choice-list__item__description";
      desc.innerHTML = checkForLink(elem.description);
      function select() {
        cleanCopyFromOption();
        cleanItemSelection();
        setFieldValidationStatus("items", true);
        if (getFieldValidationStatus("name")) {
          refreshSubmitButtonState();
        }
      }
      radio.addEventListener("change", select);
      return item;
    }
    function drawIcon(elem) {
      var iconDiv = document.createElement("div");
      if (elem.iconXml) {
        iconDiv.className = "jenkins-choice-list__item__icon";
        iconDiv.innerHTML = elem.iconXml;
      } else if (elem.iconClassName && elem.iconQualifiedUrl) {
        iconDiv.className = "jenkins-choice-list__item__icon";
        var img1 = document.createElement("img");
        img1.src = elem.iconQualifiedUrl;
        iconDiv.appendChild(img1);

        // Example for Freestyle project
        // <div class="icon"><img class="icon-freestyle-project icon-xlg" src="/jenkins/static/108b2346/images/48x48/freestyleproject.png"></div>
      } else if (elem.iconFilePathPattern) {
        iconDiv.className = "jenkins-choice-list__item__icon";
        var iconFilePath = jRoot + "/" + elem.iconFilePathPattern.replace(":size", "48x48");
        var img2 = document.createElement("img");
        img2.src = iconFilePath;
        iconDiv.appendChild(img2);

        // Example for Maven project
        // <div class="icon"><img src="/jenkins/plugin/maven-plugin/images/48x48/mavenmoduleset.png"></div>
      } else {
        var name = elem.displayName;
        var aName = name.split(" ");
        var a = name.substring(0, 1);
        var b = aName.length === 1 ? name.substring(1, 2) : aName[1].substring(0, 1);
        var spanFakeImgA = document.createElement("span");
        spanFakeImgA.className = "a";
        spanFakeImgA.innerText = a;
        iconDiv.appendChild(spanFakeImgA);
        var spanFakeImgB = document.createElement("span");
        spanFakeImgB.className = "b";
        spanFakeImgB.innerText = b;
        iconDiv.appendChild(spanFakeImgB);
        iconDiv.className = "jenkins-choice-list__item__icon";

        // Example for MockFolder
        // <div class="default-icon c-49728B"><span class="a">M</span><span class="b">o</span></div>
      }
      return iconDiv;
    }

    // The main panel content is hidden by default via an inline style. We're ready to remove that now.
    document.querySelector("#add-item-panel").removeAttribute("style");

    // Render all categories
    var $categories = document.querySelector(".categories");
    data.categories.forEach(elem => {
      drawCategory(elem).forEach(e => $categories.append(e));
    });

    // Init NameField
    function nameFieldEvent() {
      if (!isItemNameEmpty()) {
        var itemName = nameInput.value;
        fetch(`checkJobName?value=${encodeURIComponent(itemName)}`).then(response => {
          response.text().then(data => {
            var message = parseResponseFromCheckJobName(data);
            if (message !== "") {
              activateValidationMessage(message);
              setFieldValidationStatus("name", false);
              refreshSubmitButtonState();
            } else {
              activateValidationMessage("");
              setFieldValidationStatus("name", true);
              refreshSubmitButtonState();
            }
          });
        });
      } else {
        setFieldValidationStatus("name", false);
        activateValidationMessage(getI18n("empty-name"));
        refreshSubmitButtonState();
      }
    }
    nameInput.addEventListener("blur", nameFieldEvent);
    nameInput.addEventListener("input", () => {
      nameInput.dataset.dirty = "true";
      nameFieldEvent();
    });

    // Init CopyFromField
    function copyFromFieldEvent() {
      if (getCopyFromValue() === "") {
        copyRadio.removeAttribute("checked");
      } else {
        cleanItemSelection();
        copyRadio.setAttribute("checked", true);
        setFieldValidationStatus("from", true);
        refreshSubmitButtonState();
      }
    }
    copyFromInput?.addEventListener("blur", copyFromFieldEvent);
    copyFromInput?.addEventListener("input", copyFromFieldEvent);

    // Focus the Name input on load
    document.querySelector("#add-item-panel #name").focus();

    // Disable the Submit button on load
    refreshSubmitButtonState();
  });
  if (copyRadio !== null) {
    copyRadio.addEventListener("change", () => {
      copyFromInput.focus();
    });
  }
});

/***/ }),

/***/ 4218:
/***/ (function() {

// extracted by mini-css-extract-plugin

/***/ }),

/***/ 4559:
/***/ (function(__unused_webpack_module, __unused_webpack___webpack_exports__, __webpack_require__) {

"use strict";
/* harmony import */ var _node_modules_style_loader_dist_runtime_injectStylesIntoStyleTag_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(5072);
/* harmony import */ var _node_modules_style_loader_dist_runtime_injectStylesIntoStyleTag_js__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(_node_modules_style_loader_dist_runtime_injectStylesIntoStyleTag_js__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var _node_modules_style_loader_dist_runtime_styleDomAPI_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(7825);
/* harmony import */ var _node_modules_style_loader_dist_runtime_styleDomAPI_js__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(_node_modules_style_loader_dist_runtime_styleDomAPI_js__WEBPACK_IMPORTED_MODULE_1__);
/* harmony import */ var _node_modules_style_loader_dist_runtime_insertBySelector_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(7659);
/* harmony import */ var _node_modules_style_loader_dist_runtime_insertBySelector_js__WEBPACK_IMPORTED_MODULE_2___default = /*#__PURE__*/__webpack_require__.n(_node_modules_style_loader_dist_runtime_insertBySelector_js__WEBPACK_IMPORTED_MODULE_2__);
/* harmony import */ var _node_modules_style_loader_dist_runtime_setAttributesWithoutAttributes_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(5056);
/* harmony import */ var _node_modules_style_loader_dist_runtime_setAttributesWithoutAttributes_js__WEBPACK_IMPORTED_MODULE_3___default = /*#__PURE__*/__webpack_require__.n(_node_modules_style_loader_dist_runtime_setAttributesWithoutAttributes_js__WEBPACK_IMPORTED_MODULE_3__);
/* harmony import */ var _node_modules_style_loader_dist_runtime_insertStyleElement_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(540);
/* harmony import */ var _node_modules_style_loader_dist_runtime_insertStyleElement_js__WEBPACK_IMPORTED_MODULE_4___default = /*#__PURE__*/__webpack_require__.n(_node_modules_style_loader_dist_runtime_insertStyleElement_js__WEBPACK_IMPORTED_MODULE_4__);
/* harmony import */ var _node_modules_style_loader_dist_runtime_styleTagTransform_js__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(1113);
/* harmony import */ var _node_modules_style_loader_dist_runtime_styleTagTransform_js__WEBPACK_IMPORTED_MODULE_5___default = /*#__PURE__*/__webpack_require__.n(_node_modules_style_loader_dist_runtime_styleTagTransform_js__WEBPACK_IMPORTED_MODULE_5__);
/* harmony import */ var _node_modules_mini_css_extract_plugin_dist_loader_js_ruleSet_1_rules_0_use_1_node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_0_use_2_node_modules_postcss_loader_dist_cjs_js_ruleSet_1_rules_0_use_3_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_0_use_4_add_item_scss__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(4218);
/* harmony import */ var _node_modules_mini_css_extract_plugin_dist_loader_js_ruleSet_1_rules_0_use_1_node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_0_use_2_node_modules_postcss_loader_dist_cjs_js_ruleSet_1_rules_0_use_3_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_0_use_4_add_item_scss__WEBPACK_IMPORTED_MODULE_6___default = /*#__PURE__*/__webpack_require__.n(_node_modules_mini_css_extract_plugin_dist_loader_js_ruleSet_1_rules_0_use_1_node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_0_use_2_node_modules_postcss_loader_dist_cjs_js_ruleSet_1_rules_0_use_3_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_0_use_4_add_item_scss__WEBPACK_IMPORTED_MODULE_6__);

      
      
      
      
      
      
      
      
      

var options = {};

options.styleTagTransform = (_node_modules_style_loader_dist_runtime_styleTagTransform_js__WEBPACK_IMPORTED_MODULE_5___default());
options.setAttributes = (_node_modules_style_loader_dist_runtime_setAttributesWithoutAttributes_js__WEBPACK_IMPORTED_MODULE_3___default());
options.insert = _node_modules_style_loader_dist_runtime_insertBySelector_js__WEBPACK_IMPORTED_MODULE_2___default().bind(null, "head");
options.domAPI = (_node_modules_style_loader_dist_runtime_styleDomAPI_js__WEBPACK_IMPORTED_MODULE_1___default());
options.insertStyleElement = (_node_modules_style_loader_dist_runtime_insertStyleElement_js__WEBPACK_IMPORTED_MODULE_4___default());

var update = _node_modules_style_loader_dist_runtime_injectStylesIntoStyleTag_js__WEBPACK_IMPORTED_MODULE_0___default()((_node_modules_mini_css_extract_plugin_dist_loader_js_ruleSet_1_rules_0_use_1_node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_0_use_2_node_modules_postcss_loader_dist_cjs_js_ruleSet_1_rules_0_use_3_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_0_use_4_add_item_scss__WEBPACK_IMPORTED_MODULE_6___default()), options);




       /* unused harmony default export */ var __WEBPACK_DEFAULT_EXPORT__ = ((_node_modules_mini_css_extract_plugin_dist_loader_js_ruleSet_1_rules_0_use_1_node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_0_use_2_node_modules_postcss_loader_dist_cjs_js_ruleSet_1_rules_0_use_3_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_0_use_4_add_item_scss__WEBPACK_IMPORTED_MODULE_6___default()) && (_node_modules_mini_css_extract_plugin_dist_loader_js_ruleSet_1_rules_0_use_1_node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_0_use_2_node_modules_postcss_loader_dist_cjs_js_ruleSet_1_rules_0_use_3_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_0_use_4_add_item_scss__WEBPACK_IMPORTED_MODULE_6___default().locals) ? (_node_modules_mini_css_extract_plugin_dist_loader_js_ruleSet_1_rules_0_use_1_node_modules_css_loader_dist_cjs_js_ruleSet_1_rules_0_use_2_node_modules_postcss_loader_dist_cjs_js_ruleSet_1_rules_0_use_3_node_modules_sass_loader_dist_cjs_js_ruleSet_1_rules_0_use_4_add_item_scss__WEBPACK_IMPORTED_MODULE_6___default().locals) : undefined);


/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		__webpack_modules__[moduleId](module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/******/ 	// expose the modules object (__webpack_modules__)
/******/ 	__webpack_require__.m = __webpack_modules__;
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/chunk loaded */
/******/ 	!function() {
/******/ 		var deferred = [];
/******/ 		__webpack_require__.O = function(result, chunkIds, fn, priority) {
/******/ 			if(chunkIds) {
/******/ 				priority = priority || 0;
/******/ 				for(var i = deferred.length; i > 0 && deferred[i - 1][2] > priority; i--) deferred[i] = deferred[i - 1];
/******/ 				deferred[i] = [chunkIds, fn, priority];
/******/ 				return;
/******/ 			}
/******/ 			var notFulfilled = Infinity;
/******/ 			for (var i = 0; i < deferred.length; i++) {
/******/ 				var chunkIds = deferred[i][0];
/******/ 				var fn = deferred[i][1];
/******/ 				var priority = deferred[i][2];
/******/ 				var fulfilled = true;
/******/ 				for (var j = 0; j < chunkIds.length; j++) {
/******/ 					if ((priority & 1 === 0 || notFulfilled >= priority) && Object.keys(__webpack_require__.O).every(function(key) { return __webpack_require__.O[key](chunkIds[j]); })) {
/******/ 						chunkIds.splice(j--, 1);
/******/ 					} else {
/******/ 						fulfilled = false;
/******/ 						if(priority < notFulfilled) notFulfilled = priority;
/******/ 					}
/******/ 				}
/******/ 				if(fulfilled) {
/******/ 					deferred.splice(i--, 1)
/******/ 					var r = fn();
/******/ 					if (r !== undefined) result = r;
/******/ 				}
/******/ 			}
/******/ 			return result;
/******/ 		};
/******/ 	}();
/******/ 	
/******/ 	/* webpack/runtime/compat get default export */
/******/ 	!function() {
/******/ 		// getDefaultExport function for compatibility with non-harmony modules
/******/ 		__webpack_require__.n = function(module) {
/******/ 			var getter = module && module.__esModule ?
/******/ 				function() { return module['default']; } :
/******/ 				function() { return module; };
/******/ 			__webpack_require__.d(getter, { a: getter });
/******/ 			return getter;
/******/ 		};
/******/ 	}();
/******/ 	
/******/ 	/* webpack/runtime/define property getters */
/******/ 	!function() {
/******/ 		// define getter functions for harmony exports
/******/ 		__webpack_require__.d = function(exports, definition) {
/******/ 			for(var key in definition) {
/******/ 				if(__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) {
/******/ 					Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
/******/ 				}
/******/ 			}
/******/ 		};
/******/ 	}();
/******/ 	
/******/ 	/* webpack/runtime/global */
/******/ 	!function() {
/******/ 		__webpack_require__.g = (function() {
/******/ 			if (typeof globalThis === 'object') return globalThis;
/******/ 			try {
/******/ 				return this || new Function('return this')();
/******/ 			} catch (e) {
/******/ 				if (typeof window === 'object') return window;
/******/ 			}
/******/ 		})();
/******/ 	}();
/******/ 	
/******/ 	/* webpack/runtime/hasOwnProperty shorthand */
/******/ 	!function() {
/******/ 		__webpack_require__.o = function(obj, prop) { return Object.prototype.hasOwnProperty.call(obj, prop); }
/******/ 	}();
/******/ 	
/******/ 	/* webpack/runtime/runtimeId */
/******/ 	!function() {
/******/ 		__webpack_require__.j = 132;
/******/ 	}();
/******/ 	
/******/ 	/* webpack/runtime/jsonp chunk loading */
/******/ 	!function() {
/******/ 		// no baseURI
/******/ 		
/******/ 		// object to store loaded and loading chunks
/******/ 		// undefined = chunk not loaded, null = chunk preloaded/prefetched
/******/ 		// [resolve, reject, Promise] = chunk loading, 0 = chunk loaded
/******/ 		var installedChunks = {
/******/ 			132: 0
/******/ 		};
/******/ 		
/******/ 		// no chunk on demand loading
/******/ 		
/******/ 		// no prefetching
/******/ 		
/******/ 		// no preloaded
/******/ 		
/******/ 		// no HMR
/******/ 		
/******/ 		// no HMR manifest
/******/ 		
/******/ 		__webpack_require__.O.j = function(chunkId) { return installedChunks[chunkId] === 0; };
/******/ 		
/******/ 		// install a JSONP callback for chunk loading
/******/ 		var webpackJsonpCallback = function(parentChunkLoadingFunction, data) {
/******/ 			var chunkIds = data[0];
/******/ 			var moreModules = data[1];
/******/ 			var runtime = data[2];
/******/ 			// add "moreModules" to the modules object,
/******/ 			// then flag all "chunkIds" as loaded and fire callback
/******/ 			var moduleId, chunkId, i = 0;
/******/ 			if(chunkIds.some(function(id) { return installedChunks[id] !== 0; })) {
/******/ 				for(moduleId in moreModules) {
/******/ 					if(__webpack_require__.o(moreModules, moduleId)) {
/******/ 						__webpack_require__.m[moduleId] = moreModules[moduleId];
/******/ 					}
/******/ 				}
/******/ 				if(runtime) var result = runtime(__webpack_require__);
/******/ 			}
/******/ 			if(parentChunkLoadingFunction) parentChunkLoadingFunction(data);
/******/ 			for(;i < chunkIds.length; i++) {
/******/ 				chunkId = chunkIds[i];
/******/ 				if(__webpack_require__.o(installedChunks, chunkId) && installedChunks[chunkId]) {
/******/ 					installedChunks[chunkId][0]();
/******/ 				}
/******/ 				installedChunks[chunkId] = 0;
/******/ 			}
/******/ 			return __webpack_require__.O(result);
/******/ 		}
/******/ 		
/******/ 		var chunkLoadingGlobal = self["webpackChunkjenkins_ui"] = self["webpackChunkjenkins_ui"] || [];
/******/ 		chunkLoadingGlobal.forEach(webpackJsonpCallback.bind(null, 0));
/******/ 		chunkLoadingGlobal.push = webpackJsonpCallback.bind(null, chunkLoadingGlobal.push.bind(chunkLoadingGlobal));
/******/ 	}();
/******/ 	
/******/ 	/* webpack/runtime/nonce */
/******/ 	!function() {
/******/ 		__webpack_require__.nc = undefined;
/******/ 	}();
/******/ 	
/************************************************************************/
/******/ 	
/******/ 	// startup
/******/ 	// Load entry module and return exports
/******/ 	// This entry module depends on other loaded chunks and execution need to be delayed
/******/ 	__webpack_require__.O(undefined, [96], function() { return __webpack_require__(4461); })
/******/ 	var __webpack_exports__ = __webpack_require__.O(undefined, [96], function() { return __webpack_require__(4559); })
/******/ 	__webpack_exports__ = __webpack_require__.O(__webpack_exports__);
/******/ 	
/******/ })()
;
//# sourceMappingURL=add-item.js.map
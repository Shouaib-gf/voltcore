/******/ (function() { // webpackBootstrap
/******/ 	"use strict";

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
;// ./src/main/js/pages/computer-set/index.js

document.querySelector("#button-computer-icon-legend").addEventListener("click", () => {
  const template = document.querySelector("#template-computer-icon-legend");
  const title = template.getAttribute("data-title");
  const content = createElementFromHtml("<div>" + template.innerHTML + "</div>");
  dialog.modal(content, {
    maxWidth: "550px",
    title: title
  });
});
/******/ })()
;
//# sourceMappingURL=computer-set.js.map
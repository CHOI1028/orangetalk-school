/* Copyright (c) 2026 오렌지팜 주식회사. All rights reserved. See LICENSE-KO. */
/* view-fragment-loader.js — HTML 프래그먼트 동적 로더 */

function ViewFragmentLoader(api) {
  this.api = api || null;
  this.cache = {};
}
ViewFragmentLoader.prototype.inlineFragment = function(hostId, html){
  const host = document.getElementById(hostId);
  if(!host) return false;
  host.outerHTML = html;
  return true;
};
ViewFragmentLoader.prototype.loadFragment = function(fragmentPath){
  const self = this;
  if(self.cache[fragmentPath]) return Promise.resolve(self.cache[fragmentPath]);
  if(!(self.api && self.api.readFile)) return Promise.resolve('');
  return self.api.readFile('__app__/' + fragmentPath).then(function(res){
    if(!res || !res.success || !res.data) return '';
    self.cache[fragmentPath] = res.data;
    return res.data;
  }).catch(function(){ return ''; });
};
ViewFragmentLoader.prototype.mountFragment = function(hostId, fragmentPath){
  const self = this;
  return self.loadFragment(fragmentPath).then(function(html){
    if(!html) return false;
    return self.inlineFragment(hostId, html);
  });
};
export { ViewFragmentLoader };
export const viewFragmentLoader = new ViewFragmentLoader(window.electronAPI || null);

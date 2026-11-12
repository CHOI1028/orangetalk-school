'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),out=path.join(root,'_preview/survey-relay-bundle');
const files=['survey-server/router.js','survey-server/README.md','survey-server/public/index.html','survey-server/public/survey.css','survey-server/public/respond.js','src/shared/survey-model.js'];
for(const name of files){const dest=path.join(out,name);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(root,name),dest);}
fs.writeFileSync(path.join(out,'package.json'),JSON.stringify({name:'orangetalk-survey-relay',private:true,version:'1.0.0',engines:{node:'>=18'},dependencies:{express:require('../package.json').dependencies.express}},null,2)+'\n');
console.log(out);

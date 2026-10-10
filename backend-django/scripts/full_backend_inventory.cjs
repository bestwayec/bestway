// Read-only metadata inventory; never instantiate AppModule or connect providers.
const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
const root = path.resolve(__dirname, '../../backend');
const ref = createRequire(path.join(root, 'package.json'));
ref('reflect-metadata');
const ts = ref('typescript');
const {RequestMethod} = ref('@nestjs/common');
const files = [];
function walk(dir) { for (const item of fs.readdirSync(dir, {withFileTypes:true})) {
  const file=path.join(dir,item.name); if(item.isDirectory())walk(file); else if(file.endsWith('.ts')&&!file.endsWith('.spec.ts'))files.push(file);
}}
walk(path.join(root,'src'));
const routes=[],services=[],jobs=[],events=[],gateways=[],guards=[];
for (const file of files) {
  const source=fs.readFileSync(file,'utf8'), relative=path.relative(root,file).replaceAll('\\','/');
  const parsed=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
  if(file.endsWith('.controller.ts')) {
    const built=path.join(root,'dist',path.relative(path.join(root,'src'),file).replace(/\.ts$/,'.js'));
    if(!fs.existsSync(built))throw Error('Missing built reference '+relative);
    const exports=ref(built);
    for(const controller of Object.values(exports)) {
      if(typeof controller!=='function'||!Reflect.hasMetadata('path',controller))continue;
      const prefixes=[Reflect.getMetadata('path',controller)].flat();
      for(const name of Object.getOwnPropertyNames(controller.prototype)) {
        if(name==='constructor')continue;
        const fn=controller.prototype[name], method=Reflect.getMetadata('method',fn), route=Reflect.getMetadata('path',fn);
        if(method===undefined||route===undefined)continue;
        for(const prefix of prefixes)for(const suffix of [route].flat())routes.push({module:relative.split('/')[1],controller:controller.name,source:relative,handler:name,method:RequestMethod[method],path:('/v1/'+prefix+'/'+suffix).replace(/\/{2,}/g,'/').replace(/\/$/,''),roles:Reflect.getMetadata('roles',fn)??Reflect.getMetadata('roles',controller)??[],auth:Reflect.getMetadata('isPublic',fn)??Reflect.getMetadata('isPublic',controller)?'public':Reflect.getMetadata('optionalAuth',fn)??Reflect.getMetadata('optionalAuth',controller)?'optional':'JWT',status:Reflect.getMetadata('__httpCode__',fn)??(method===RequestMethod.POST?201:200)});
      }
    }
  }
  function visit(node) {
    if(ts.isClassDeclaration(node)&&node.name) {
      const name=node.name.text;
      const tables=[...source.matchAll(/(?:this\.)?prisma\.(\w+)/g)].map(m=>m[1]).filter(n=>!n.startsWith('$'));
      const row={name,source:relative,tables:[...new Set(tables)]};
      if(/Service$/.test(name))services.push(row);
      if(/Guard$/.test(name))guards.push(row);
      if(/Gateway$/.test(name))gateways.push(row);
      for(const member of node.members) {
        const decorators=ts.canHaveDecorators(member)?ts.getDecorators(member)||[]:[];
        for(const decorator of decorators) {
          const value=decorator.getText(parsed);
          const entry={...row,handler:member.name?.getText(parsed),decorator:value};
          if(/^@(Cron|Interval|Timeout)\(/.test(value))jobs.push(entry);
          if(/^@(OnEvent|SubscribeMessage)\(/.test(value))events.push(entry);
        }
      }
    }
    ts.forEachChild(node,visit);
  }
  visit(parsed);
}
const schema=fs.readFileSync(path.join(root,'prisma/schema.prisma'),'utf8');
const models=[...schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)].map(m=>({name:m[1],definition:m[2].trim()}));
const enums=[...schema.matchAll(/^enum\s+(\w+)\s*\{([\s\S]*?)^\}/gm)].map(m=>({name:m[1],values:m[2].replace(/\/\/[^\n]*/g,'').trim().split(/\s+/)}));
const prismaNames=new Set(models.map(m=>m.name[0].toLowerCase()+m.name.slice(1)));
for(const row of [...services,...guards,...jobs,...events,...gateways])row.tables=row.tables.filter(t=>prismaNames.has(t));
process.stdout.write(JSON.stringify({routes,services,guards,jobs,events,gateways,models,enums},null,2));

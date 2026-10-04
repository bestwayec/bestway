const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
// Synthetic tone clips and two original pictures; deliberately test-only.
module.exports = function createFixtureAssets(root) {
  const dir = path.join(root,'test-only'); fs.mkdirSync(dir,{recursive:true});
  const samples = 8000 * 60, wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length-8,4); wav.write('WAVEfmt ',8); wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22); wav.writeUInt32LE(8000,24); wav.writeUInt32LE(16000,28); wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34); wav.write('data',36); wav.writeUInt32LE(samples*2,40);
  for(let i=0;i<samples;i++) wav.writeInt16LE(Math.round(600*Math.sin(i*2*Math.PI*220/8000)),44+i*2);
  for(let i=0;i<6;i++) fs.writeFileSync(path.join(dir,`community-${i}.wav`),wav);
  const width=640,height=240, pixels=Buffer.alloc(height*(width*3+1));
  const rect=(x,y,w,h,color)=>{for(let py=y;py<y+h;py++)for(let px=x;px<x+w;px++)for(let c=0;c<3;c++)pixels[py*(width*3+1)+1+px*3+c]=color[c];};
  rect(0,0,320,240,[240,229,205]); rect(320,0,320,240,[128,202,245]); rect(320,140,320,100,[111,177,91]);
  for(let row=0;row<3;row++){rect(20,35+row*52,270,9,[102,69,42]);for(let book=0;book<12;book++)rect(24+book*22,9+row*52,15,25,book%2?[68,122,157]:[191,102,70]);}
  rect(70,190,190,12,[102,69,42]);rect(90,200,12,40,[102,69,42]);rect(230,200,12,40,[102,69,42]);
  for(const x of [365,545]){rect(x+15,90,14,85,[121,80,40]);rect(x,40,46,70,[60,134,67]);}
  rect(440,180,82,12,[121,80,40]);rect(450,192,10,28,[121,80,40]);rect(500,192,10,28,[121,80,40]);
  const crc=(b)=>{let c=0xffffffff;for(const v of b){c^=v;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;};
  const chunk=(type,data)=>{const name=Buffer.from(type), length=Buffer.alloc(4), check=Buffer.alloc(4);length.writeUInt32BE(data.length);check.writeUInt32BE(crc(Buffer.concat([name,data])));return Buffer.concat([length,name,data,check]);};
  const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
  const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
  fs.writeFileSync(path.join(dir,'community-pictures.png'),png);
};

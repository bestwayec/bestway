// Local-only responsive audit: screenshots + layout checks at 4 sizes (synthetic accounts).
// RUNNER_URL / RESULT_URL: paths of an in-progress and a completed attempt.
// SECTIONS_URL (optional): path of an in-progress attempt with all 4 sections, owned by +998900000011;
//   adds exam-runner-<skill> pages via ?skill=. BW_THEME=light|dark (default: the app default, dark).
// BW_ONLY (optional): comma-separated page names to capture.
// node responsive-audit.mjs <out-dir>
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
const WEB=process.env.BW_WEB || "http://127.0.0.1:3300"; const OUT=process.argv[2]; mkdirSync(OUT,{recursive:true});
const SIZES=[[1440,900],[768,1024],[390,844],[360,640]];
const PAGES=[ ["landing",null,"/en"], ["login",null,"/en/login"], ["student-dashboard","+998900000011","/en/dashboard"],
  ["exam-list","+998900000011","/en/mock"], ["vocabulary","+998900000011","/en/vocabulary"], ["leaderboard","+998900000011","/en/leaderboard"],
  ["profile","+998900000011","/en/profile"], ["exam-runner","+998900000010","RUNNER"], ["exam-result","+998900000011","RESULT"],
  ["teacher-dashboard","+998900000003","/en/dashboard"], ["exam-builder","+998900000003","/en/exam-builder"], ["groups","+998900000003","/en/groups"],
  ["attendance","+998900000003","/en/attendance"], ["admin-dashboard","+998900000002","/en/dashboard"], ["students-admin","+998900000002","/en/students"] ];
if (process.env.SECTIONS_URL) for (const skill of ["listening","reading","writing","speaking"])
  PAGES.push([`exam-runner-${skill}`,"+998900000011",`${process.env.SECTIONS_URL}?skill=${skill}`]);
const ONLY=(process.env.BW_ONLY||"").split(",").filter(Boolean);
const THEME=process.env.BW_THEME||"";
const b=await chromium.launch(); const report={};
const sessions={};
async function ctxFor(phone,w,h){ const c=await b.newContext({viewport:{width:w,height:h},deviceScaleFactor:1});
  if(phone){ if(!sessions[phone]){ const p=await c.newPage(); await p.goto(WEB+"/en/login"); await p.locator('input[type="tel"], input[name="phone"]').first().fill(phone);
      await p.locator('input[type="password"]').fill("LocalDev-2026!"); await p.locator('button[type="submit"]').click(); await p.waitForURL(u=>!u.pathname.endsWith("/login"),{timeout:60000});
      sessions[phone]=await c.storageState(); await p.close(); await c.close(); return ctxFor(phone,w,h);} 
    await c.addCookies(sessions[phone].cookies); }
  return c; }
const resolve={ RUNNER: process.env.RUNNER_URL, RESULT: process.env.RESULT_URL };
for (const [name,phone,path] of PAGES) for (const [w,h] of SIZES) {
  if (ONLY.length && !ONLY.includes(name)) continue;
  const c=await ctxFor(phone,w,h); const p=await c.newPage();
  await p.addInitScript(()=>{ try{ sessionStorage.setItem("bw_fullscreen_notice_seen","1"); }catch{} });
  if (THEME) await p.addInitScript((t)=>{ try{ localStorage.setItem("theme",t); }catch{} }, THEME);
  try { await p.goto(WEB+(resolve[path]||path),{waitUntil:"networkidle",timeout:90000}); } catch {}
  await p.waitForTimeout(1200);
  const checks=await p.evaluate(()=>{ const vw=document.documentElement.clientWidth; const out={overflowX: document.documentElement.scrollWidth-vw, wide:[], smallTargets:0, unlabeled:0};
    for(const el of document.querySelectorAll("body *")){ const r=el.getBoundingClientRect(); if(r.width===0||r.height===0) continue; const st=getComputedStyle(el); if(st.position==="fixed"&&r.right<=vw+1) continue;
      if(r.right>vw+2 && out.wide.length<6 && !el.closest("[data-allow-overflow],pre,table,.overflow-x-auto,[class*='overflow-x']")) out.wide.push(`${el.tagName.toLowerCase()}.${(el.className&&el.className.baseVal===undefined?el.className:"").toString().split(" ").slice(0,3).join(".")}:${Math.round(r.right)}`); }
    for(const el of document.querySelectorAll("button,a[href],[role=button],input,select")){ const r=el.getBoundingClientRect(); if(r.width&&r.height&&(r.height<32||r.width<32)&&getComputedStyle(el).visibility!=="hidden") out.smallTargets++; }
    for(const el of document.querySelectorAll("input:not([type=hidden]),select,textarea")){ const id=el.id; const lab=el.getAttribute("aria-label")||el.getAttribute("aria-labelledby")||(id&&document.querySelector(`label[for="${id}"]`))||el.closest("label")||el.getAttribute("title"); if(!lab && el.offsetParent) out.unlabeled++; }
    return out; });
  const file=`${name}-${w}x${h}.jpg`; await p.screenshot({path:`${OUT}/${file}`,fullPage:false,type:"jpeg",quality:70});
  report[`${name}@${w}`]=checks; await c.close();
}
writeFileSync(`${OUT}/report.json`,JSON.stringify(report,null,1)); await b.close();
for (const [k,v] of Object.entries(report)) if (v.overflowX>0||v.wide.length||v.unlabeled) console.log(k,`overflowX=${v.overflowX}`,`unlabeled=${v.unlabeled}`,`small=${v.smallTargets}`,v.wide.slice(0,3).join(" "));

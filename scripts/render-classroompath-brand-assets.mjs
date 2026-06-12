/**
 * Renders ClassroomPath brand assets (icons, splash screens) from source SVGs using Playwright Chromium.
 *
 * Invoked by: Developer CLI for asset regeneration; run manually when brand assets change.
 * Usage: node scripts/render-classroompath-brand-assets.mjs [--output-dir <dir>]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const brandDir = resolve(projectRoot, 'react-spa/public/brand');

const slate = '#0f172a';
const slateMuted = '#334155';
const blue = '#2563eb';
const blueSoft = '#dbeafe';
const teal = '#0f9488';
const tealSoft = '#ccfbf1';
const offWhite = '#f8fafc';
const paper = '#f3f7f6';
const warm = '#f4ead7';
const green = '#22c55e';

function logoMarkSvg(width = 128, height = 128) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 128 128" fill="none">
  <rect x="12" y="14" width="104" height="100" rx="26" fill="${offWhite}"/>
  <rect x="23" y="27" width="34" height="26" rx="8" fill="${blueSoft}"/>
  <rect x="65" y="27" width="40" height="26" rx="8" fill="#e0f2fe"/>
  <rect x="23" y="62" width="40" height="38" rx="10" fill="${tealSoft}"/>
  <rect x="71" y="62" width="34" height="38" rx="10" fill="#e2e8f0"/>
  <path d="M31 91C45 77 55 70 70 68C85 66 94 55 102 38" stroke="${teal}" stroke-width="10" stroke-linecap="round"/>
  <path d="M31 91C45 77 55 70 70 68C85 66 94 55 102 38" stroke="${offWhite}" stroke-width="4" stroke-linecap="round" opacity=".75"/>
  <circle cx="31" cy="91" r="9" fill="${blue}"/>
  <circle cx="102" cy="38" r="9" fill="${green}"/>
  <path d="M42 45H49M79 45H92M37 82H50M84 82H94" stroke="${slateMuted}" stroke-width="4" stroke-linecap="round" opacity=".5"/>
</svg>`;
}

function horizontalLogoSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="128" viewBox="0 0 560 128" fill="none">
  ${logoMarkSvg(128, 128).replace('<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128" fill="none">', '<g>').replace('</svg>', '</g>')}
  <text x="152" y="75" fill="${slate}" font-family="Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="46" font-weight="760" letter-spacing="0">ClassroomPath</text>
  <path d="M154 94H414" stroke="${teal}" stroke-width="6" stroke-linecap="round"/>
</svg>`;
}

function faviconSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 128 128" fill="none">
  <rect x="8" y="8" width="112" height="112" rx="30" fill="${slate}"/>
  <rect x="23" y="27" width="34" height="26" rx="8" fill="#e0f2fe"/>
  <rect x="65" y="27" width="40" height="26" rx="8" fill="${blueSoft}"/>
  <rect x="23" y="62" width="40" height="38" rx="10" fill="${tealSoft}"/>
  <rect x="71" y="62" width="34" height="38" rx="10" fill="#f1f5f9"/>
  <path d="M31 91C45 77 55 70 70 68C85 66 94 55 102 38" stroke="${teal}" stroke-width="11" stroke-linecap="round"/>
  <path d="M31 91C45 77 55 70 70 68C85 66 94 55 102 38" stroke="${offWhite}" stroke-width="4" stroke-linecap="round" opacity=".78"/>
  <circle cx="31" cy="91" r="9" fill="${blue}"/>
  <circle cx="102" cy="38" r="9" fill="${green}"/>
</svg>`;
}

function authHeroSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200" viewBox="0 0 1600 1200" fill="none">
  <rect width="1600" height="1200" fill="${paper}"/>
  <path d="M0 950C260 820 420 920 645 800C850 690 1030 620 1600 780V1200H0V950Z" fill="#e6f4f1"/>
  <path d="M1080 120C1300 180 1430 320 1488 520" stroke="#d7e7ef" stroke-width="3" stroke-dasharray="18 18"/>
  <path d="M160 265H960" stroke="#d7e7ef" stroke-width="3" stroke-dasharray="12 20"/>
  <rect x="210" y="190" width="760" height="540" rx="42" fill="white" stroke="#cbd5e1" stroke-width="6"/>
  <rect x="250" y="242" width="680" height="82" rx="22" fill="${slate}"/>
  <circle cx="292" cy="283" r="12" fill="${green}"/>
  <circle cx="330" cy="283" r="12" fill="${teal}"/>
  <rect x="374" y="270" width="226" height="22" rx="11" fill="#cbd5e1"/>
  <rect x="278" y="372" width="292" height="260" rx="30" fill="#eff6ff"/>
  <rect x="622" y="372" width="262" height="58" rx="20" fill="${tealSoft}"/>
  <rect x="622" y="462" width="262" height="58" rx="20" fill="#e0f2fe"/>
  <rect x="622" y="552" width="214" height="58" rx="20" fill="#ecfdf5"/>
  <path d="M338 553C382 495 430 468 506 453" stroke="${teal}" stroke-width="18" stroke-linecap="round"/>
  <circle cx="338" cy="553" r="18" fill="${blue}"/>
  <circle cx="506" cy="453" r="18" fill="${green}"/>
  <rect x="318" y="668" width="560" height="30" rx="15" fill="#cbd5e1"/>
  <rect x="1028" y="310" width="328" height="430" rx="48" fill="${slate}"/>
  <rect x="1070" y="365" width="244" height="208" rx="30" fill="#e0f2fe"/>
  <path d="M1108 526C1140 485 1180 468 1242 458" stroke="${teal}" stroke-width="14" stroke-linecap="round"/>
  <circle cx="1108" cy="526" r="14" fill="${blue}"/>
  <circle cx="1242" cy="458" r="14" fill="${green}"/>
  <rect x="1086" y="620" width="130" height="24" rx="12" fill="${tealSoft}"/>
  <rect x="1086" y="664" width="196" height="24" rx="12" fill="#f1f5f9"/>
  <path d="M1084 810C1122 732 1260 732 1302 810" fill="${warm}"/>
  <circle cx="1192" cy="692" r="46" fill="${warm}"/>
  <path d="M1132 780H1252C1302 780 1342 820 1342 870V956H1042V870C1042 820 1082 780 1132 780Z" fill="${teal}"/>
  <rect x="384" y="838" width="232" height="118" rx="22" fill="white" stroke="#cbd5e1" stroke-width="5"/>
  <rect x="436" y="882" width="128" height="24" rx="12" fill="${blueSoft}"/>
  <rect x="676" y="838" width="232" height="118" rx="22" fill="white" stroke="#cbd5e1" stroke-width="5"/>
  <rect x="728" y="882" width="128" height="24" rx="12" fill="${tealSoft}"/>
  <rect x="248" y="1030" width="1052" height="32" rx="16" fill="#cbd5e1"/>
</svg>`;
}

function onboardingSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000" fill="none">
  <rect width="1600" height="1000" fill="${offWhite}"/>
  <circle cx="216" cy="180" r="106" fill="#e0f2fe"/>
  <circle cx="1400" cy="784" r="144" fill="#dcfce7"/>
  <path d="M210 785C460 600 700 704 922 532C1120 378 1298 392 1456 482" stroke="#d7e7ef" stroke-width="4" stroke-dasharray="18 20"/>
  <rect x="356" y="180" width="888" height="530" rx="48" fill="white" stroke="#cbd5e1" stroke-width="6"/>
  <rect x="412" y="236" width="776" height="76" rx="24" fill="${slate}"/>
  <rect x="462" y="262" width="216" height="24" rx="12" fill="#cbd5e1"/>
  <rect x="1072" y="258" width="70" height="28" rx="14" fill="${green}"/>
  <rect x="438" y="376" width="238" height="208" rx="30" fill="#eff6ff"/>
  <rect x="724" y="376" width="238" height="208" rx="30" fill="${tealSoft}"/>
  <rect x="1010" y="376" width="132" height="208" rx="30" fill="#f1f5f9"/>
  <rect x="482" y="430" width="126" height="20" rx="10" fill="${blue}"/>
  <rect x="482" y="480" width="150" height="18" rx="9" fill="#93c5fd"/>
  <rect x="482" y="526" width="96" height="18" rx="9" fill="#93c5fd"/>
  <rect x="768" y="430" width="112" height="20" rx="10" fill="${teal}"/>
  <rect x="768" y="480" width="146" height="18" rx="9" fill="#5eead4"/>
  <rect x="768" y="526" width="88" height="18" rx="9" fill="#5eead4"/>
  <path d="M492 652H1054" stroke="${teal}" stroke-width="14" stroke-linecap="round"/>
  <circle cx="492" cy="652" r="22" fill="${blue}"/>
  <circle cx="772" cy="652" r="22" fill="${teal}"/>
  <circle cx="1054" cy="652" r="22" fill="${green}"/>
  <path d="M202 786C246 704 378 704 422 786" fill="${warm}"/>
  <circle cx="312" cy="666" r="42" fill="${warm}"/>
  <path d="M256 754H370C418 754 456 792 456 840V904H170V840C170 792 208 754 256 754Z" fill="${slateMuted}"/>
  <path d="M1170 820C1212 742 1346 742 1388 820" fill="#eadcc2"/>
  <circle cx="1278" cy="700" r="42" fill="#eadcc2"/>
  <path d="M1224 788H1332C1382 788 1422 828 1422 878V920H1134V878C1134 828 1174 788 1224 788Z" fill="${teal}"/>
  <rect x="564" y="780" width="472" height="68" rx="24" fill="#e0f2fe"/>
  <rect x="622" y="804" width="236" height="20" rx="10" fill="${slateMuted}"/>
  <circle cx="946" cy="814" r="14" fill="${green}"/>
</svg>`;
}

function waitingSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900" fill="none">
  <rect width="1200" height="900" fill="${offWhite}"/>
  <path d="M118 668C292 548 452 612 618 494C772 384 930 384 1088 462V900H118V668Z" fill="#e6f4f1"/>
  <rect x="288" y="146" width="624" height="514" rx="50" fill="white" stroke="#cbd5e1" stroke-width="6"/>
  <rect x="362" y="230" width="476" height="86" rx="26" fill="${blueSoft}"/>
  <rect x="410" y="262" width="220" height="22" rx="11" fill="${blue}"/>
  <circle cx="770" cy="273" r="18" fill="${green}"/>
  <rect x="362" y="364" width="476" height="74" rx="24" fill="${tealSoft}"/>
  <rect x="410" y="391" width="170" height="20" rx="10" fill="${teal}"/>
  <rect x="362" y="486" width="476" height="74" rx="24" fill="#f1f5f9"/>
  <rect x="410" y="513" width="242" height="20" rx="10" fill="${slateMuted}"/>
  <path d="M238 704C276 634 394 634 432 704" fill="${warm}"/>
  <circle cx="336" cy="598" r="38" fill="${warm}"/>
  <path d="M286 674H386C432 674 468 710 468 756V810H204V756C204 710 240 674 286 674Z" fill="${slateMuted}"/>
  <path d="M802 716C844 638 970 638 1012 716" fill="#eadcc2"/>
  <circle cx="906" cy="602" r="42" fill="#eadcc2"/>
  <path d="M852 686H960C1008 686 1048 724 1048 774V812H764V774C764 724 804 686 852 686Z" fill="${teal}"/>
  <path d="M522 704H678" stroke="${teal}" stroke-width="14" stroke-linecap="round"/>
  <circle cx="522" cy="704" r="21" fill="${blue}"/>
  <circle cx="678" cy="704" r="21" fill="${green}"/>
</svg>`;
}

function ogCoverSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" fill="none">
  <rect width="1200" height="630" fill="${slate}"/>
  <path d="M0 486C208 388 354 424 528 336C720 240 890 246 1200 332V630H0V486Z" fill="#123747"/>
  <path d="M92 126H536" stroke="#275d71" stroke-width="3" stroke-dasharray="14 18"/>
  <g transform="translate(76 82) scale(.82)">${logoMarkSvg(128, 128)
    .replace(
      '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128" fill="none">',
      ''
    )
    .replace('</svg>', '')}</g>
  <text x="210" y="145" fill="${offWhite}" font-family="Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="46" font-weight="760" letter-spacing="0">ClassroomPath</text>
  <text x="84" y="272" fill="#dbeafe" font-family="Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="34" font-weight="680" letter-spacing="0">Internet intencional para aulas</text>
  <text x="84" y="324" fill="#a7f3d0" font-family="Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="24" font-weight="560" letter-spacing="0">transparencia open source · operación institucional</text>
  <rect x="688" y="112" width="358" height="284" rx="34" fill="white" opacity=".96"/>
  <rect x="726" y="154" width="282" height="60" rx="18" fill="#e0f2fe"/>
  <rect x="726" y="246" width="126" height="92" rx="22" fill="${tealSoft}"/>
  <rect x="882" y="246" width="126" height="92" rx="22" fill="#eff6ff"/>
  <path d="M754 316C798 268 842 258 904 244" stroke="${teal}" stroke-width="13" stroke-linecap="round"/>
  <circle cx="754" cy="316" r="16" fill="${blue}"/>
  <circle cx="904" cy="244" r="16" fill="${green}"/>
  <path d="M780 500C812 438 920 438 954 500" fill="${warm}"/>
  <circle cx="868" cy="412" r="34" fill="${warm}"/>
  <path d="M824 476H914C954 476 986 508 986 548V584H752V548C752 508 784 476 824 476Z" fill="${teal}"/>
  <rect x="628" y="518" width="466" height="24" rx="12" fill="#275d71"/>
</svg>`;
}

async function renderPng(page, fileName, svg, width, height, { transparent = false } = {}) {
  await page.setViewportSize({ width, height });
  await page.setContent(
    `<!doctype html><html><head><style>html,body,#asset{margin:0;width:${width}px;height:${height}px;overflow:hidden;background:transparent}svg{display:block;width:${width}px;height:${height}px}</style></head><body><div id="asset">${svg}</div></body></html>`,
    { waitUntil: 'load' }
  );
  await page.screenshot({
    path: resolve(brandDir, fileName),
    fullPage: false,
    omitBackground: transparent,
  });
}

async function main() {
  await mkdir(brandDir, { recursive: true });

  await writeFile(resolve(brandDir, 'classroompath-logo-mark.svg'), logoMarkSvg(), 'utf8');
  await writeFile(
    resolve(brandDir, 'classroompath-logo-horizontal.svg'),
    horizontalLogoSvg(),
    'utf8'
  );

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 512, height: 512 } });

  await renderPng(page, 'classroompath-favicon-512.png', faviconSvg(), 512, 512, {
    transparent: true,
  });
  await renderPng(page, 'classroompath-auth-hero.png', authHeroSvg(), 1600, 1200);
  await renderPng(page, 'classroompath-onboarding-governance.png', onboardingSvg(), 1600, 1000);
  await renderPng(page, 'classroompath-waiting-room.png', waitingSvg(), 1200, 900);
  await renderPng(page, 'classroompath-og-cover.png', ogCoverSvg(), 1200, 630);

  await browser.close();
}

await main();

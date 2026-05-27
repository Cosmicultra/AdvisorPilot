/**
 * Portfolio report PDF palette — matches full_11_page_report_preview.html.
 * Fonts: OFL Playfair Display + IBM Plex (see public/fonts/).
 */
import { rgb } from "pdf-lib";

export const PAGE_W = 612;
export const PAGE_H = 792;
export const MARGIN = 52;
export const CONTENT_W = PAGE_W - MARGIN * 2;

export const colors = {
  navy: rgb(11 / 255, 21 / 255, 64 / 255),
  navyMid: rgb(21 / 255, 32 / 255, 96 / 255),
  navyRule: rgb(26 / 255, 45 / 255, 110 / 255),
  accent: rgb(37 / 255, 99 / 255, 196 / 255),
  accentLight: rgb(106 / 255, 174 / 255, 245 / 255),
  accentMuted: rgb(74 / 255, 127 / 255, 193 / 255),
  ink: rgb(58 / 255, 54 / 255, 48 / 255),
  muted: rgb(154 / 255, 148 / 255, 136 / 255),
  pageBg: rgb(250 / 255, 248 / 255, 244 / 255),
  surface: rgb(247 / 255, 244 / 255, 239 / 255),
  synopsisBg: rgb(242 / 255, 239 / 255, 233 / 255),
  rule: rgb(226 / 255, 221 / 255, 214 / 255),
  ruleLight: rgb(238 / 255, 232 / 255, 224 / 255),
  white: rgb(1, 1, 1),
  scoreRed: rgb(192 / 255, 57 / 255, 43 / 255),
  scoreBlue: rgb(11 / 255, 21 / 255, 64 / 255),
  headerText: rgb(200 / 255, 218 / 255, 245 / 255),
  headerEyebrow: rgb(45 / 255, 80 / 255, 138 / 255),
  headerMeta: rgb(138 / 255, 171 / 255, 219 / 255),
  donutEquity: rgb(37 / 255, 99 / 255, 196 / 255),
  donutFixed: rgb(11 / 255, 21 / 255, 64 / 255),
  donutCash: rgb(200 / 255, 168 / 255, 58 / 255),
  donutOther: rgb(154 / 255, 148 / 255, 136 / 255),
  donutTrack: rgb(236 / 255, 232 / 255, 226 / 255),
  tableHeadText: rgb(1, 1, 1),
  tableZebra: rgb(247 / 255, 244 / 255, 239 / 255),
  tableFoot: rgb(240 / 255, 236 / 255, 228 / 255),
  calloutBorder: rgb(226 / 255, 221 / 255, 214 / 255),
  footerMuted: rgb(184 / 255, 178 / 255, 168 / 255),
  footerDisc: rgb(204 / 255, 200 / 255, 192 / 255),
} as const;

export const layout = {
  /** Navy cover band: eyebrow + title/stat row + 5-column info bar (matches preview HTML). */
  coverBandHeight: 224,
  coverPadTop: 27,
  coverRowGap: 21,
  coverLogoSize: 60,
  /** Clear space between logo box bottom and PORTFOLIO VALUE label (template ~20px). */
  coverStatGapBelowLogo: 20,
  /** Gap between PORTFOLIO VALUE baseline and top of dollar amount glyphs. */
  coverStatGapLabelToValue: 8,
  coverTitleSize: 26,
  coverStatSize: 20,
  coverInfoBarHeight: 40,
  bodyPadTop: 28,
  compactHeaderHeight: 56,
  footerSafeY: 74,
  sectionGap: 28,
  insightFontSize: 9,
  insightLineGap: 5.5,
  insightBulletX: MARGIN + 2,
  insightTextX: MARGIN + 14,
  insightWrapW: CONTENT_W - 14,
  synopsisInsetX: MARGIN + 14,
  synopsisWrapW: CONTENT_W - 28,
} as const;

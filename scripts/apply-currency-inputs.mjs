import fs from "fs";

const p = "app/app/legacy-app-shell.tsx";
let s = fs.readFileSync(p, "utf8");
const end = "</" + "d" + "iv" + ">";

if (!s.includes('import { CurrencyAmountInput }')) {
  s = s.replace(
    'import { LogoBlock } from "@/components/logo-block";',
    'import { CurrencyAmountInput } from "@/components/currency-amount-input";\nimport { LogoBlock } from "@/components/logo-block";'
  );
}

function replaceOnce(pattern, replacement, label) {
  const re = typeof pattern === "string" ? pattern : pattern;
  if (!re.test(s)) {
    console.warn("SKIP (not found):", label);
    return false;
  }
  s = s.replace(re, replacement);
  console.log("OK:", label);
  return true;
}

function dollarWrapper(fieldRegex, onChangeReplacement, placeholder, wrapperClass, inputClass = "") {
  const re = new RegExp(
    `<div className="${wrapperClass.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}">\\s*` +
      '<span className="[^"]*">\\$</span>\\s*' +
      "<Input[\\s\\S]*?" +
      `value=\\{${fieldRegex}\\}` +
      "[\\s\\S]*?" +
      `placeholder="[^"]*"` +
      "[\\s\\S]*?/>\\s*" +
      end.replace("/", "\\/"),
    "g"
  );
  const ic = inputClass ? ` inputClassName="${inputClass}"` : "";
  return `<CurrencyAmountInput className="${wrapperClass.replace(/^mt-\d+ /, "").replace("flex h-14 ", "").replace("flex h-12 ", "").replace("flex h-11 ", "")}"${ic} value={${fieldRegex}} onChange={${onChangeReplacement}} placeholder="${placeholder}" />`;
}

// Intake Q3 AGI
replaceOnce(
  /<div className="mt-2 flex h-14 items-center overflow-hidden rounded-none border border-blue-100 bg-white focus-within:ring-2 focus-within:ring-sky-500"><span className="pl-4 text-lg font-medium text-slate-600">\$<\/span><Input className="h-full flex-1 border-0 bg-transparent pl-1 pr-4 text-lg shadow-none focus-visible:ring-0" type="text" inputMode="decimal" value=\{client\.adjustedGrossIncomeAnnual\} onChange=\{\(e\) => setClient\(\{ \.\.\.client, adjustedGrossIncomeAnnual: e\.target\.value \}\)\} placeholder="165432" \/><\/div>/,
  '<CurrencyAmountInput className="mt-2 h-14 border-blue-100 focus-within:ring-sky-500" inputClassName="text-lg" value={client.adjustedGrossIncomeAnnual} onChange={(v) => setClient({ ...client, adjustedGrossIncomeAnnual: v })} placeholder="165,000" />',
  "intake AGI"
);

// Intake Q6 retirement income  
replaceOnce(
  /<div className="mt-2 flex h-14 items-center overflow-hidden rounded-none border border-blue-100 bg-white focus-within:ring-2 focus-within:ring-sky-500"><span className="pl-4 text-lg font-medium text-slate-600">\$<\/span><Input className="h-full flex-1 border-0 bg-transparent pl-1 pr-4 text-lg shadow-none focus-visible:ring-0" type="text" inputMode="decimal" value=\{client\.retirementSpendableIncomeAnnual\} onChange=\{\(e\) => setClient\(\{ \.\.\.client, retirementSpendableIncomeAnnual: e\.target\.value \}\)\} placeholder="85000" \/><\/motion>/,
  '<CurrencyAmountInput className="mt-2 h-14 border-blue-100 focus-within:ring-sky-500" inputClassName="text-lg" value={client.retirementSpendableIncomeAnnual} onChange={(v) => setClient({ ...client, retirementSpendableIncomeAnnual: v })} placeholder="85,000" />',
  "intake retirement income"
);

// Fix motion typo in pattern - use div
s = fs.readFileSync(p, "utf8");
if (!s.includes('import { CurrencyAmountInput }')) {
  s = s.replace(
    'import { LogoBlock } from "@/components/logo-block";',
    'import { CurrencyAmountInput } from "@/components/currency-amount-input";\nimport { LogoBlock } from "@/components/logo-block";'
  );
}

const fields = [
  {
    label: "FIA premium illustration",
    re: /<label className="text-sm font-semibold text-slate-700">Premium for illustration \(\$\)<\/label>\s*<Input[\s\S]*?registrationPremiumOverride: e\.target\.value[\s\S]*?\/>/,
    neu: (m) => m.replace(
      /<Input[\s\S]*?\/>/,
      `<CurrencyAmountInput
                          className="mt-2 h-12 rounded-none bg-white border-input focus-within:ring-sky-500"
                          value={fiaInputValue(fiaWorksheet.registrationPremiumOverride)}
                          onChange={(v) =>
                            setFiaWorksheet((w) => ({ ...w, registrationPremiumOverride: v }))
                          }
                          placeholder={
                            fiaWorksheet.premiumSource === "qualified"
                              ? traditionalQualifiedTotal > 0
                                ? \`Blank = full \${currency(traditionalQualifiedTotal)}\`
                                : "Enter amount or confirm qualified holdings"
                              : nonQualifiedTotal > 0
                                ? \`Blank = full \${currency(nonQualifiedTotal)}\`
                                : "Enter amount or confirm non-qualified holdings"
                          } />`
    ),
  },
  {
    label: "Roth specific amount",
    re: /<label className="text-sm font-semibold text-slate-700">Specific dollar amount<\/label>\s*<div className="mt-2 flex h-12 items-center overflow-hidden rounded-none border border-blue-100 bg-white focus-within:ring-2 focus-within:ring-sky-500">[\s\S]*?specificConversionAmount: e\.target\.value[\s\S]*?<\/div>/,
    neu: `<label className="text-sm font-semibold text-slate-700">Specific dollar amount</label>
                    <CurrencyAmountInput
                      className="mt-2 h-12 border-blue-100 focus-within:ring-sky-500"
                      value={rothWorksheet.specificConversionAmount}
                      onChange={(v) => setRothWorksheet((w) => ({ ...w, specificConversionAmount: v }))}
                      placeholder="250,000"
                    />`,
  },
  {
    label: "SS client wages",
    re: /<label className="text-xs font-semibold text-slate-700">Annual covered earnings \(SS wages\)<\/label>\s*<motion className="mt-1 flex h-11[\s\S]*?value=\{retIncSsEstClientAnnual\}[\s\S]*?<\/motion>/,
    neu: `<label className="text-xs font-semibold text-slate-700">Annual covered earnings (SS wages)</label>
                              <CurrencyAmountInput
                                className="mt-1 h-11 border-slate-200 focus-within:ring-sky-500"
                                inputClassName="text-sm"
                                value={retIncSsEstClientAnnual}
                                onChange={setRetIncSsEstClientAnnual}
                                placeholder="85,000"
                              />`,
  },
];

console.log("Script needs manual fix - use field-specific replacements");

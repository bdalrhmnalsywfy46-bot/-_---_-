// استخراج أرقام الموبايل من نص الرسالة (مصري + دولي بعلامة +)
const AR = '٠١٢٣٤٥٦٧٨٩';
const FA = '۰۱۲۳۴۵۶۷۸۹';

export function toLatinDigits(s = '') {
  return s.replace(/[٠-٩]/g, (d) => AR.indexOf(d)).replace(/[۰-۹]/g, (d) => FA.indexOf(d));
}

// موبايل مصري: 010 / 011 / 012 / 015 + 8 أرقام، بأي مسافات أو شرطات، مع أو من غير +20
const EG = /(?<!\d)(?:\+?20|0020)?[\s-]?0?1[0125](?:[\s\-.]?\d){8}(?!\d)/g;
// أرقام دولية لازم تبدأ بـ +
const INTL = /(?<!\d)\+\d(?:[\s\-.]?\d){9,13}(?!\d)/g;

export function extractPhones(text = '') {
  const t = toLatinDigits(text);
  const found = new Set();

  for (const m of t.matchAll(EG)) {
    const d = m[0].replace(/\D/g, '');
    found.add('0' + d.slice(-10));
  }
  for (const m of t.matchAll(INTL)) {
    const d = m[0].replace(/\D/g, '');
    if (d.startsWith('20')) continue; // مصري، اتعالج فوق
    found.add('+' + d);
  }
  return [...found];
}

export function waLink(phone) {
  if (phone.startsWith('+')) return `https://wa.me/${phone.slice(1)}`;
  return `https://wa.me/20${phone.slice(1)}`;
}

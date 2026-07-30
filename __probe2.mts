import { ISO_COUNTRIES } from './src/lib/countries/data';
const q = 'st';
const old = ISO_COUNTRIES.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q));
console.log('main-behaviour count', old.length);
console.log('main first 6:', old.slice(0,6).map(c=>`${c.code}:${c.name}`).join(' | '));
console.log('index of ST in main list:', old.findIndex(c=>c.code==='ST'));

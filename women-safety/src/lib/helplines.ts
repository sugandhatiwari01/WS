/** Official national helpline numbers in India (toll-free, work from any phone). */
export type Helpline = { number: string; label: string; detail: string };

export const INDIA_HELPLINES: Helpline[] = [
  { number: "112", label: "Emergency (police, fire, ambulance)", detail: "Emergency Response Support System — works everywhere in India" },
  { number: "100", label: "Police", detail: "Police control room" },
  { number: "1091", label: "Women helpline (police)", detail: "Women in distress — police helpline" },
  { number: "181", label: "Women helpline", detail: "Ministry of Women & Child Development — counselling, shelter, legal aid" },
  { number: "1930", label: "Cyber crime", detail: "National Cyber Crime helpline — online harassment, fraud" },
  { number: "108", label: "Ambulance", detail: "Medical emergencies" },
];

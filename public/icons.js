// Premium SVG icon library (Lucide/Heroicons style — stroke-based, 1.5px)
export function icon(name, size = 20, color = 'currentColor') {
  const p = P[name];
  if (!p) return '';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="ico" aria-hidden="true">${p}</svg>`;
}

// Large illustrated gender icons (filled, for registration cards)
export const genderIcon = {
  male: `<svg width="60" height="60" viewBox="0 0 60 60" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="30" cy="21" r="12" fill="#DBEAFE" stroke="#1D4ED8" stroke-width="1.8"/>
    <path d="M10 56c0-11.05 8.95-20 20-20s20 8.95 20 20" fill="#DBEAFE" stroke="#1D4ED8" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M27 33 30 37.5 33 33" stroke="#1D4ED8" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <line x1="27" y1="33" x2="25" y2="38" stroke="#1D4ED8" stroke-width="1.2" stroke-linecap="round" opacity="0.5"/>
    <line x1="33" y1="33" x2="35" y2="38" stroke="#1D4ED8" stroke-width="1.2" stroke-linecap="round" opacity="0.5"/>
  </svg>`,
  female: `<svg width="60" height="60" viewBox="0 0 60 60" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M18 18c-2-10 5-16 12-16s14 6 12 16" fill="#BE185D" opacity="0.25"/>
    <circle cx="30" cy="20" r="12" fill="#FCE7F3" stroke="#BE185D" stroke-width="1.8"/>
    <path d="M20 56l6-21h8l6 21H20z" fill="#FCE7F3" stroke="#BE185D" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M26 35 30 41 34 35" stroke="#BE185D" stroke-width="1.4" fill="none" stroke-linecap="round" opacity="0.7"/>
  </svg>`,
};

// Icon path library
const P = {
  // People
  user:        `<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>`,
  user_plus:   `<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>`,
  user_check:  `<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/>`,
  users:       `<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>`,

  // Communication
  bell:        `<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>`,
  message:     `<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>`,
  send:        `<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>`,
  phone:       `<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13.5 19.79 19.79 0 0 1 1.58 4.87 2 2 0 0 1 3.55 2.68h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 10a16 16 0 0 0 6 6l.92-.92a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.73 17z"/>`,

  // Status / Actions
  check:       `<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>`,
  check_sm:    `<polyline points="20 6 9 17 4 12"/>`,
  x_circle:    `<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>`,
  x:           `<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>`,
  hourglass:   `<path d="M5 22h14M5 2h14"/><path d="M17 22v-4.17a2 2 0 0 0-.59-1.42L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22"/><path d="M7 2v4.17a2 2 0 0 0 .59 1.42L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2"/>`,
  info:        `<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>`,

  // Media / Upload
  camera:      `<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>`,
  id_card:     `<rect x="2" y="5" width="20" height="14" rx="2.5"/><circle cx="8.5" cy="12" r="2.5"/><path d="M14 9.5h5M14 12h4M14 14.5h3"/>`,
  image:       `<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>`,
  upload:      `<polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>`,

  // Location & Time
  pin:         `<path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z"/><circle cx="12" cy="10" r="3"/>`,
  clock:       `<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>`,
  calendar:    `<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>`,
  map:         `<polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/>`,

  // Places / Buildings
  building:    `<path d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-4h6v4M9 10.5h2M13 10.5h2M9 14.5h2M13 14.5h2"/>`,
  utensils:    `<line x1="3" y1="2" x2="3" y2="8"/><path d="M5 2v3a2 2 0 0 1-4 0V2"/><path d="M12 2v20"/><path d="M12 7l4-5v10l-4-5z"/>`,
  coffee:      `<path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/>`,
  museum:      `<path d="M3 21h18M3 10h18M12 3 3 10h18L12 3z"/><rect x="5" y="10" width="4" height="11"/><rect x="10" y="10" width="4" height="11"/><rect x="15" y="10" width="4" height="11"/>`,
  hotel:       `<path d="M3 21h18M3 7h18M3 7V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2"/><path d="M9 21V7M15 21V7"/><rect x="5" y="10" width="3" height="3"/><rect x="16" y="10" width="3" height="3"/><rect x="5" y="15" width="3" height="3"/><rect x="16" y="15" width="3" height="3"/>`,
  fountain:    `<path d="M12 22V12"/><path d="M12 12c0-4 4-8 4-8s-2 4 0 5-4 3-4 3z"/><path d="M12 12c0-4-4-8-4-8s2 4 0 5 4 3 4 3z"/><ellipse cx="12" cy="19" rx="7" ry="3"/><path d="M8 22h8"/>`,
  monument:    `<path d="M12 2 4 20h16L12 2z"/><rect x="6" y="20" width="12" height="3"/><rect x="4" y="23" width="16" height="1"/>`,

  // Navigation
  arrow_right: `<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>`,
  arrow_left:  `<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>`,
  chevron_right:`<polyline points="9 18 15 12 9 6"/>`,

  // Booking
  bookmark:    `<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>`,
  list:        `<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>`,
  guests:      `<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>`,

  // Misc
  star:        `<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>`,
  key:         `<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>`,
  lock:        `<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>`,
  logout:      `<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>`,
};

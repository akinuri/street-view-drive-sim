const STORAGE_KEY = "lang";

const dict = {
  en: {
    "ph.origin": "A · Origin (address or click map)",
    "ph.dest": "B · Destination",
    "btn.routes": "Get routes",
    "btn.reset": "Reset",
    "title.reset": "Clear pins, routes and the drive, and start over",
    "findme": "Find me",
    "title.findme": "Center the map on your location (asks for browser permission)",
    "route": "Route",
    "jump": "Jump distance",
    "title.jump": "How far each view jump moves you. Shorter jumps look smoother but need more API calls. Applies on 'Drive this route'.",
    "opt.every": "Every panorama",
    "drive": "Drive this route",
    "title.copy": "Copy link to this route",
    "aria.copy": "Copy link",
    "prev": "Prev",
    "next": "Next",
    "play": "Play",
    "pause": "Pause",
    "title.prev": "Previous (←)",
    "title.play": "Play/Pause (Space)",
    "title.next": "Next (→)",
    "jps": "Jumps per second",
    "title.jps": "How many view jumps happen each second",
    "speed.125": "1 per 8 s",
    "speed.250": "1 per 4 s",
    "speed.500": "1 per 2 s",
    "speed.1000": "1 per s",
    "speed.2000": "2 per s",
    "speed.4000": "4 per s",
    "title.speedinfo": "Approximate travel speed = jump distance x jumps per second",
    "ph.key": "Google Maps API key",
    "title.key": "Stored only in this browser (localStorage)",
    "title.save": "Save key",
    "title.delete": "Delete saved key",
    "placeholder": "Street View appears here once you pick a route",
    "jumping": "Jumping...",
    "fullscreen": "Full screen",
    "rotate": "Rotate map",
    "title.rotate": "Keep the direction of travel pointing up on the map",

    "routeOption": "Route {n}: {km} km, {min} min",
    "st.hint": "Click the map to drop start (A) and end (B) pins, or type addresses.",
    "st.bothPins": "Both pins placed. Drag A or B to move them, or press Reset.",
    "st.pressGet": "Press Get routes.",
    "st.copied": "Link copied.",
    "st.copyFail": "Could not copy. Copy the link from the address bar instead.",
    "st.geoNone": "Geolocation is not available in this browser.",
    "st.geoFail": "Could not get your location. Check the browser's location permission.",
    "st.finding": "Finding the start of the route...",
    "st.noCoverage": "Not enough Street View coverage along this route.",
    "st.lookupFail": "Panorama lookup failed: {msg}",
    "st.enterBoth": "Please enter both an origin and a destination.",
    "st.requesting": "Requesting routes...",
    "st.routesOne": "1 route found. Click it on the map, then press \"Drive this route\".",
    "st.routesMany": "{n} routes found. Click a route on the map or pick one, then press \"Drive this route\".",
    "st.routeKm": "{km} km route",
    "st.gaps": ", {n} coverage gap(s) (~{m} m skipped)",
    "st.loading": ", loading ahead as you drive",
    "st.authFail": "Google rejected the API key. Check the key, billing, enabled APIs and referrer restrictions.",
    "err.noKey": "Enter your Google Maps API key (top right of the second row) to start.",
    "err.script": "Failed to load Google Maps JavaScript API.",
    "err.init": "Google Maps failed to initialise. Check the API key, billing and that Maps JavaScript API is enabled.",
    "err.routesHttp": "Routes API error {status}",
    "err.noRoute": "No driving route found between those locations.",
  },
  tr: {
    "ph.origin": "A · Başlangıç (adres veya haritaya tıkla)",
    "ph.dest": "B · Varış",
    "btn.routes": "Rotaları getir",
    "btn.reset": "Sıfırla",
    "title.reset": "İşaretleri, rotaları ve sürüşü temizle, baştan başla",
    "findme": "Beni bul",
    "title.findme": "Haritayı konumuna ortala (tarayıcı izni ister)",
    "route": "Rota",
    "jump": "Atlama mesafesi",
    "title.jump": "Her atlamanın seni ne kadar ilerlettiği. Kısa atlamalar daha akıcıdır ama daha fazla API çağrısı gerektirir. 'Bu rotayı sür' ile geçerli olur.",
    "opt.every": "Her panorama",
    "drive": "Bu rotayı sür",
    "title.copy": "Bu rotanın bağlantısını kopyala",
    "aria.copy": "Bağlantıyı kopyala",
    "prev": "Geri",
    "next": "İleri",
    "play": "Oynat",
    "pause": "Duraklat",
    "title.prev": "Önceki (←)",
    "title.play": "Oynat/Duraklat (Boşluk)",
    "title.next": "Sonraki (→)",
    "jps": "Saniyedeki atlama",
    "title.jps": "Her saniye kaç görünüm atlaması olacağı",
    "speed.125": "8 sn'de 1",
    "speed.250": "4 sn'de 1",
    "speed.500": "2 sn'de 1",
    "speed.1000": "sn'de 1",
    "speed.2000": "sn'de 2",
    "speed.4000": "sn'de 4",
    "title.speedinfo": "Yaklaşık hız = atlama mesafesi x saniyedeki atlama",
    "ph.key": "Google Maps API anahtarı",
    "title.key": "Yalnızca bu tarayıcıda saklanır (localStorage)",
    "title.save": "Anahtarı kaydet",
    "title.delete": "Kayıtlı anahtarı sil",
    "placeholder": "Bir rota seçtiğinde Street View burada görünür",
    "jumping": "Atlanıyor...",
    "fullscreen": "Tam ekran",
    "rotate": "Haritayı döndür",
    "title.rotate": "Gidiş yönünü haritada hep yukarı tut",

    "routeOption": "Rota {n}: {km} km, {min} dk",
    "st.hint": "Başlangıç (A) ve varış (B) işaretlerini koymak için haritaya tıkla veya adres yaz.",
    "st.bothPins": "İki işaret de konuldu. A veya B'yi sürükleyerek taşı ya da Sıfırla'ya bas.",
    "st.pressGet": "Rotaları getir'e bas.",
    "st.copied": "Bağlantı kopyalandı.",
    "st.copyFail": "Kopyalanamadı. Bağlantıyı adres çubuğundan kopyala.",
    "st.geoNone": "Bu tarayıcıda konum özelliği yok.",
    "st.geoFail": "Konumun alınamadı. Tarayıcının konum iznini kontrol et.",
    "st.finding": "Rotanın başlangıcı aranıyor...",
    "st.noCoverage": "Bu rota boyunca yeterli Street View kapsamı yok.",
    "st.lookupFail": "Panorama araması başarısız: {msg}",
    "st.enterBoth": "Lütfen başlangıç ve varış noktalarını gir.",
    "st.requesting": "Rotalar isteniyor...",
    "st.routesOne": "1 rota bulundu. Haritada ona tıkla, sonra \"Bu rotayı sür\"e bas.",
    "st.routesMany": "{n} rota bulundu. Haritada bir rotaya tıkla veya listeden seç, sonra \"Bu rotayı sür\"e bas.",
    "st.routeKm": "{km} km rota",
    "st.gaps": ", {n} kapsam boşluğu (~{m} m atlandı)",
    "st.loading": ", sürdükçe ilerisi yükleniyor",
    "st.authFail": "Google API anahtarını reddetti. Anahtarı, faturalandırmayı, etkin API'leri ve yönlendiren (referrer) kısıtlarını kontrol et.",
    "err.noKey": "Başlamak için Google Maps API anahtarını gir (ikinci satırın sağ üstü).",
    "err.script": "Google Maps JavaScript API yüklenemedi.",
    "err.init": "Google Maps başlatılamadı. API anahtarını, faturalandırmayı ve Maps JavaScript API'nin etkin olduğunu kontrol et.",
    "err.routesHttp": "Routes API hatası {status}",
    "err.noRoute": "Bu konumlar arasında sürüş rotası bulunamadı.",
  },
};

export const LANGS = Object.keys(dict);

let lang = localStorage.getItem(STORAGE_KEY);
if (!dict[lang]) lang = navigator.language?.toLowerCase().startsWith("tr") ? "tr" : "en";

export const getLang = () => lang;

/** Translate a key; text that isn't a known key is returned unchanged. {name} placeholders are filled from params. */
export function t(key, params = {}) {
  const s = dict[lang][key] ?? dict.en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => params[k] ?? "");
}

/** Apply translations to elements marked with data-i18n, data-i18n-title, data-i18n-ph and data-i18n-aria. */
export function applyStatic() {
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll("[data-i18n-title]")) el.title = t(el.dataset.i18nTitle);
  for (const el of document.querySelectorAll("[data-i18n-ph]")) el.placeholder = t(el.dataset.i18nPh);
  for (const el of document.querySelectorAll("[data-i18n-aria]")) el.setAttribute("aria-label", t(el.dataset.i18nAria));
}

export function setLang(next) {
  if (!dict[next]) return;
  lang = next;
  localStorage.setItem(STORAGE_KEY, next);
  applyStatic();
}

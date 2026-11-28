// Conversion en MP3 des fichiers audio que le navigateur ne sait pas lire (WMA, APE, AC3, AMR…).
// Le convertisseur (FFmpeg pour le web, ~5,5 Mo) est chargé seulement sur cette page.
// Les fichiers arrivent depuis le dépôt (IndexedDB) et y retournent convertis.
'use strict';
const $ = (s) => document.querySelector(s);
const RETOUR = 'index.html#/deposer/reprise';

function ouvrirBase() {
  return new Promise((ok, ko) => {
    const r = indexedDB.open('mongongo-conversion', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('travail');
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  });
}
async function lireTravail() {
  const db = await ouvrirBase();
  return new Promise((ok, ko) => { const q = db.transaction('travail').objectStore('travail').get('courant'); q.onsuccess = () => ok(q.result); q.onerror = () => ko(q.error); });
}
async function ecrireTravail(t) {
  const db = await ouvrirBase();
  return new Promise((ok, ko) => { const tx = db.transaction('travail', 'readwrite'); tx.objectStore('travail').put(t, 'courant'); tx.oncomplete = ok; tx.onerror = () => ko(tx.error); });
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const retour = () => location.replace(RETOUR);
$('#btn-annuler').onclick = retour;
$('#btn-retour').onclick = retour;
function echec(msg) {
  $('#erreur').innerHTML = msg; $('#erreur').classList.remove('cache');
  $('#intro').textContent = 'La conversion n\'a pas pu se faire sur cet appareil.';
}

// ---------- FFmpeg ----------
let module = null, journal = [], finCommande = null;
function surSortie(texte) {
  journal.push(texte);
  if (journal.length > 400) journal.shift();
  const d = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(texte);
  if (d && finCommande) finCommande.duree = (+d[1]) * 3600 + (+d[2]) * 60 + parseFloat(d[3]);
  const t = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(texte);
  if (t && finCommande?.duree) finCommande.progres?.(Math.min(1, ((+t[1]) * 3600 + (+t[2]) * 60 + parseFloat(t[3])) / finCommande.duree));
  if (finCommande && /muxing overhead|Invalid data found|Conversion failed|At least one output file|Error opening|could not find codec|No such file|Output file is empty|does not contain any stream/i.test(texte)) {
    const ok = /muxing overhead/i.test(texte);
    const f = finCommande; finCommande = null;
    setTimeout(() => f.fini(ok), ok ? 400 : 0);
  }
}
// FFmpeg garde des réglages d'une commande à l'autre : on démarre donc un convertisseur neuf pour chaque fichier
// (le fichier .wasm n'est téléchargé qu'une fois).
let binaire = null;
async function chargerFFmpeg() {
  if (!binaire) {
    const r = await fetch('ffmpeg.core.wasm');
    if (!r.ok) throw new Error('fichier ffmpeg.core.wasm introuvable (' + r.status + ')');
    binaire = await r.arrayBuffer();
  }
  if (module) { try { module.PThread?.terminateAllThreads?.(); } catch (_) {} }
  module = await createFFmpegCore({
    print: surSortie, printErr: surSortie,
    locateFile: (chemin) => new URL(chemin, location.href).href,
    wasmBinary: binaire,
    noExitRuntime: true
  });
}
function executer(args, progres) {
  return new Promise((ok) => {
    let delai = null;
    finCommande = { progres, duree: 0, fini: (r) => { clearInterval(delai); ok(r); } };
    // Sécurité : si FFmpeg ne dit plus rien pendant 60 s, on considère la commande terminée
    let dernier = journal.length, calme = 0;
    delai = setInterval(() => {
      if (journal.length !== dernier) { dernier = journal.length; calme = 0; return; }
      if (++calme >= 60 && finCommande) { const f = finCommande; finCommande = null; f.fini(false); }
    }, 1000);
    module.callMain(['-y', '-hide_banner', '-nostdin', '-stats_period', '0.5', ...args]);
  });
}
async function attendreFichierStable(nom) {
  let avant = -1;
  for (let i = 0; i < 20; i++) {
    let taille = -1;
    try { taille = module.FS.stat(nom).size; } catch (_) {}
    if (taille > 0 && taille === avant) return true;
    avant = taille;
    await new Promise((r) => setTimeout(r, 250));
  }
  return avant > 0;
}

(async function principal() {
  // La conversion a besoin d'une page « isolée » (préparée par le service worker de l'application)
  if (!self.crossOriginIsolated) {
    let essai = 0;
    try { essai = +sessionStorage.getItem('mw-isolation') || 0; } catch (_) {}
    if ('serviceWorker' in navigator && essai < 2) {
      try { sessionStorage.setItem('mw-isolation', String(essai + 1)); } catch (_) {}
      const reg = await navigator.serviceWorker.register('sw.js').catch(() => null);
      try { await reg?.update(); } catch (_) {}
      await navigator.serviceWorker.ready;
      await new Promise((r) => setTimeout(r, 800));
      location.reload();
      return;
    }
    return echec('Ce navigateur ne permet pas la conversion dans l\'application. Convertissez les fichiers en MP3 avec un autre logiciel (par exemple VLC ou un convertisseur en ligne), puis déposez-les.');
  }
  try { sessionStorage.removeItem('mw-isolation'); } catch (_) {}

  const travail = await lireTravail().catch(() => null);
  if (!travail?.fichiers?.length) return echec('Aucun fichier à convertir. <a href="' + RETOUR + '" style="color:#e8b04b">Revenir au dépôt</a>');
  const aFaire = travail.fichiers.filter((f) => f.aConvertir && !f.converti);
  $('#liste').innerHTML = aFaire.map((f, i) => `<div class="ligne" id="l${i}"><span class="nom">${esc(f.nom)}</span><span class="etat">en attente</span></div>`).join('');
  const ligne = (i, cls, txt) => { const l = $('#l' + i); l.className = 'ligne ' + cls; l.querySelector('.etat').textContent = txt; };

  $('#etat').textContent = 'Chargement du convertisseur (5 Mo, une seule fois)…';
  try { await chargerFFmpeg(); }
  catch (e) { console.error(e); return echec('Le convertisseur n\'a pas pu se charger : ' + esc(e?.message || e) + '. Vérifiez la connexion internet puis réessayez.'); }
  $('#intro').textContent = `${aFaire.length} fichier${aFaire.length > 1 ? 's' : ''} à convertir en MP3. Gardez l'écran allumé : vous reviendrez automatiquement au dépôt à la fin.`;
  let verrou = null;
  try { verrou = await navigator.wakeLock?.request('screen'); } catch (_) {}

  let reussis = 0;
  for (let i = 0; i < aFaire.length; i++) {
    const f = aFaire[i];
    ligne(i, 'en-cours', 'conversion…');
    journal = [];
    $('#etat').textContent = `Fichier ${i + 1} / ${aFaire.length}`;
    const ext = (f.nom.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
    const entree = `entree${i}.${ext}`, sortie = `sortie${i}.mp3`;
    try {
      if (i > 0) await chargerFFmpeg();
      module.FS.writeFile(entree, new Uint8Array(await f.blob.arrayBuffer()));
      const ok = await executer(['-i', entree, '-vn', '-map', '0:a:0', '-c:a', 'libmp3lame', '-b:a', '192k', '-ar', '44100', sortie],
        (x) => { $('#barre').style.width = Math.round(((i + x) / aFaire.length) * 100) + '%'; ligne(i, 'en-cours', Math.round(x * 100) + ' %'); });
      if (!ok || !(await attendreFichierStable(sortie))) throw new Error((journal.slice(-3).join(' ') || 'conversion impossible').slice(0, 200));
      const octets = module.FS.readFile(sortie);
      f.blob = new File([octets], f.nom.replace(/\.[^.]+$/, '') + '.mp3', { type: 'audio/mpeg' });
      f.nom = f.blob.name; f.converti = true; f.aConvertir = false; delete f.erreur;
      reussis++;
      ligne(i, 'fait', '✓ MP3 · ' + (octets.length / 1048576).toFixed(1).replace('.', ',') + ' Mo');
    } catch (e) {
      console.error(e);
      f.erreur = String(e?.message || e);
      ligne(i, 'echec', '✗ échec');
    }
    try { module.FS.unlink(entree); } catch (_) {}
    try { module.FS.unlink(sortie); } catch (_) {}
    await ecrireTravail(travail);
  }
  $('#barre').style.width = '100%';
  try { verrou?.release(); } catch (_) {}
  travail.termine = true;
  await ecrireTravail(travail);
  if (reussis === aFaire.length) {
    $('#etat').textContent = '✓ Tous les fichiers sont convertis. Retour au dépôt…';
    setTimeout(retour, 1200);
  } else {
    $('#etat').textContent = `${reussis} converti${reussis > 1 ? 's' : ''} sur ${aFaire.length}.`;
    $('#btn-retour').classList.remove('cache');
    $('#btn-annuler').classList.add('cache');
  }
})();

// =========================================================
// MONGONGO WAY — application web
// Conçue et développée par Ingénieur Van MUFWAR
// =========================================================
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://desvlycyywffuccfgkhr.supabase.co';
const SUPABASE_CLE = 'sb_publishable_up74FXoWpjmiiOPVEtcFAw_uLa8-R-Y';
const DOMAINE_TEL = 'tel.mongongoway.app'; // le téléphone sert d'identifiant
const CACHE_HORS_LIGNE = 'mongongo-hors-ligne';

const sb = createClient(SUPABASE_URL, SUPABASE_CLE);

const GENRES = ['Louange', 'Adoration', 'Gospel urbain', 'Chorale', 'Rumba gospel', 'Instrumental', 'Playback', 'Autre'];
const STATUTS_TITRE = {
  brouillon: 'Brouillon',
  en_attente_paiement: 'Envoyé — en attente',
  en_validation: 'En validation',
  publie: 'Publié',
  refuse: 'Refusé'
};
const STATUTS_ARTISTE = { en_attente: 'En attente de validation', valide: 'Validé', refuse: 'Refusé', suspendu: 'Suspendu' };

// ---------- État ----------
const etat = {
  session: null,
  profil: null,
  artiste: null,
  tarifs: {},
  enCours: null,     // titre en lecture
  file: [],          // liste affichée (pour passer au suivant)
  catalogue: [],     // tous les titres publiés (lecture aléatoire)
  historique: [],    // titres déjà joués (bouton précédent)
  finAbo: null       // fin de l'abonnement en cours
};
const estAbonne = () => !!etat.finAbo && new Date(etat.finAbo) > new Date();
const FORMULES = {
  mensuel: { nom: '1 mois', cle: 'abonnement_mensuel', defaut: 20 },
  trimestriel: { nom: '3 mois', cle: 'abonnement_trimestriel', defaut: 50 },
  annuel: { nom: '1 an', cle: 'abonnement_annuel', defaut: 250 }
};
const prixFormule = (f) => Number(etat.tarifs[FORMULES[f].cle]?.montant ?? FORMULES[f].defaut);

// ---------- Outils ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const vue = $('#vue');

function esc(t) {
  return String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function toast(msg, erreur = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('erreur', erreur);
  t.classList.add('visible');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('visible'), 3200);
}
function erreur(e) {
  console.error(e);
  const m = e?.message || String(e);
  const traductions = {
    'Invalid login credentials': 'Numéro ou mot de passe incorrect.',
    'User already registered': 'Ce numéro a déjà un compte. Connectez-vous.',
    'Password should be at least 6 characters': 'Le mot de passe doit avoir au moins 6 caractères.',
    'Email not confirmed': 'Compte pas encore activé. Contactez l\'administrateur.',
    'Failed to fetch': 'Pas de connexion internet.'
  };
  const cle = Object.keys(traductions).find((k) => m.includes(k));
  toast(cle ? traductions[cle] : m, true);
}
function chargement(msg = 'Chargement…') { vue.innerHTML = `<div class="chargement">${esc(msg)}</div>`; }
function montant(v, devise = 'USD') {
  const n = Number(v || 0);
  return devise === 'USD' ? `${n.toFixed(2).replace('.', ',')} $` : `${Math.round(n).toLocaleString('fr-FR')} FC`;
}
function duree(sec) {
  if (!sec || !isFinite(sec)) return '';
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
function dateCourte(d) {
  return new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}
function urlPochette(path) {
  if (!path) return '';
  return sb.storage.from('pochettes').getPublicUrl(path).data.publicUrl;
}
function imgPochette(path, classe = 'pochette') {
  const u = urlPochette(path);
  return u ? `<img class="${classe}" src="${esc(u)}" alt="" loading="lazy">` : `<div class="${classe}"></div>`;
}
// Numéro congolais → 243XXXXXXXXX
function normaliserTel(saisie) {
  let d = String(saisie || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = '243' + d.slice(1);
  if (d.length === 9) d = '243' + d;
  return d;
}
function telValide(d) { return /^243\d{9}$/.test(d); }
function ouvrirModale(html) {
  $('#modale-boite').innerHTML = html;
  $('#modale').classList.remove('cache');
}
function fermerModale() { $('#modale').classList.add('cache'); }
$('#modale').addEventListener('click', (e) => { if (e.target.id === 'modale' || e.target.closest('[data-fermer]')) fermerModale(); });

const estAdmin = () => etat.profil?.role === 'admin';

// ---------- Vidéo : le cadre prend la forme de la vidéo (verticale, carrée ou horizontale) ----------
function adapterVideo(v) {
  v.addEventListener('loadedmetadata', () => {
    if (v.videoWidth && v.videoHeight) v.closest('.clip')?.style.setProperty('--ratio', (v.videoWidth / v.videoHeight).toFixed(4));
  }, { once: true });
}

// ---------- Présence (visible uniquement par l'administrateur) ----------
const estEnLigne = (d) => !!d && Date.now() - new Date(d) < 3 * 60000;
function momentPrecis(d) {
  if (!d) return 'jamais';
  const j = new Date(d), heure = j.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const memeJour = (a, b) => a.toDateString() === b.toDateString();
  if (memeJour(j, new Date())) return `aujourd'hui à ${heure}`;
  if (memeJour(j, new Date(Date.now() - 864e5))) return `hier à ${heure}`;
  return `le ${dateCourte(d)} à ${heure}`;
}
let minuteriePresence = null;
function signalerPresence() {
  if (!etat.session || document.visibilityState !== 'visible') return;
  sb.rpc('signaler_presence').then(() => {});
}
function demarrerPresence() {
  clearInterval(minuteriePresence);
  if (!etat.session) return;
  signalerPresence();
  minuteriePresence = setInterval(signalerPresence, 60000);
}
document.addEventListener('visibilitychange', signalerPresence);

// ---------- Session & profil ----------
async function chargerProfil() {
  if (!etat.session) { etat.profil = null; etat.artiste = null; return; }
  const uid = etat.session.user.id;
  const [{ data: profil }, { data: artiste }, { data: tarifs }, { data: finAbo }] = await Promise.all([
    sb.from('profils').select('*').eq('id', uid).maybeSingle(),
    sb.from('artistes').select('*').eq('profil_id', uid).maybeSingle(),
    sb.from('tarifs').select('*'),
    sb.rpc('fin_abonnement')
  ]);
  etat.finAbo = finAbo || null;
  majModeLecture();
  etat.profil = profil;
  etat.artiste = artiste;
  etat.tarifs = Object.fromEntries((tarifs || []).map((t) => [t.cle, t]));
}

// ---------- Routeur ----------
const routes = {
  connexion: vueConnexion,
  accueil: vueAccueil,
  titre: vueTitre,
  artiste: vueArtiste,
  deposer: vueDeposer,
  profil: vueProfil,
  admin: vueAdmin,
  achats: vueAchats,
  soutien: vueSoutien,
  a: vuePageArtiste,
  fil: vueFil,
  messages: vueMessages,
  membre: vueMembre,
  abonnement: vueAbonnement
};

async function router() {
  const [nom, param] = (location.hash.replace(/^#\//, '') || 'accueil').split('/');
  const connecte = !!etat.session;
  $('#nav').classList.toggle('cache', !connecte);
  $('#btn-messages')?.classList.toggle('cache', !connecte);
  if (!connecte && nom !== 'connexion') { location.hash = '#/connexion'; return; }
  if (connecte && nom === 'connexion') { location.hash = '#/accueil'; return; }
  $$('#nav a').forEach((a) => a.classList.toggle('actif', a.dataset.route === nom || (nom === 'deposer' && a.dataset.route === 'artiste') || (['admin', 'achats', 'abonnement'].includes(nom) && a.dataset.route === 'profil')));
  $('#btn-messages')?.classList.toggle('actif', nom === 'messages');
  clearInterval(minuterieConversation);
  majBadgeMessages();
  window.scrollTo(0, 0);
  try {
    await (routes[nom] || vueAccueil)(param);
  } catch (e) {
    erreur(e);
    vue.innerHTML = `<div class="vide"><span class="grand">⚠</span>Impossible de charger cette page.<br><button class="btn secondaire petit" onclick="location.reload()" style="margin-top:14px">Réessayer</button></div>`;
  }
}
window.addEventListener('hashchange', router);

// =========================================================
// CONNEXION / INSCRIPTION
// =========================================================
function vueConnexion() {
  let mode = 'connexion';
  const dessiner = () => {
    vue.innerHTML = `
      <div class="accueil-connexion">
        <img src="icon-512.png" alt="">
        <h1>Mongongo <span style="color:var(--or)">Way</span></h1>
        <p class="doux">La voix des musiciens de Theway RDC.<br>Écoute gratuite, partout.</p>
        <div class="onglets">
          <button data-mode="connexion" class="${mode === 'connexion' ? 'actif' : ''}">Se connecter</button>
          <button data-mode="inscription" class="${mode === 'inscription' ? 'actif' : ''}">Créer un compte</button>
        </div>
        <form class="form-connexion" id="form-auth">
          ${mode === 'inscription' ? `
            <label for="nom">Nom complet</label>
            <input id="nom" required autocomplete="name" placeholder="Ex. Grâce Mbuyi">` : ''}
          <label for="tel">Numéro de téléphone</label>
          <input id="tel" type="tel" required inputmode="tel" autocomplete="tel" placeholder="Ex. 0812345678">
          <label for="mdp">Mot de passe</label>
          <input id="mdp" type="password" required minlength="6" autocomplete="${mode === 'inscription' ? 'new-password' : 'current-password'}" placeholder="6 caractères minimum">
          <button class="btn plein" type="submit">${mode === 'inscription' ? 'Créer mon compte' : 'Se connecter'}</button>
        </form>
      </div>`;
    $$('.onglets button').forEach((b) => b.onclick = () => { mode = b.dataset.mode; dessiner(); });
    $('#form-auth').onsubmit = async (e) => {
      e.preventDefault();
      const tel = normaliserTel($('#tel').value);
      if (!telValide(tel)) return toast('Numéro invalide. Exemple : 0812345678', true);
      const email = `${tel}@${DOMAINE_TEL}`;
      const password = $('#mdp').value;
      const bouton = e.submitter; bouton.disabled = true;
      try {
        if (mode === 'inscription') {
          const nom = $('#nom').value.trim();
          const { data, error } = await sb.auth.signUp({ email, password, options: { data: { nom_complet: nom, telephone: '+' + tel } } });
          if (error) throw error;
          if (!data.session) {
            toast('Compte créé. Il doit être activé par l\'administrateur avant la connexion.');
            mode = 'connexion'; dessiner();
            return;
          }
          toast(`Bienvenue ${nom.split(' ')[0]} !`);
        } else {
          const { error } = await sb.auth.signInWithPassword({ email, password });
          if (error) throw error;
        }
      } catch (err) { erreur(err); } finally { bouton.disabled = false; }
    };
  };
  dessiner();
}

// =========================================================
// ACCUEIL
// =========================================================
async function vueAccueil() {
  chargement();
  const { data: titres, error } = await sb
    .from('titres')
    .select('id, titre, genre, pochette_path, audio_path, video_path, duree_sec, nb_ecoutes, nb_auditeurs, prix_telechargement, prix_video, devise, publie_le, artistes(nom_scene)')
    .eq('statut', 'publie')
    .order('publie_le', { ascending: false })
    .limit(200);
  if (error) throw error;
  etat.catalogue = titres;

  const prenom = (etat.profil?.nom_complet || '').split(' ')[0];
  vue.innerHTML = `
    <div class="banniere">
      <h1>${prenom ? `Mbote ${esc(prenom)} !` : 'Mbote !'}</h1>
      <p>${estAbonne() ? 'Vous êtes abonné : écoute dans l\'ordre, clips à la suite et téléchargements gratuits.' : 'Écoute gratuite en lecture aléatoire. <a href="#/abonnement" style="color:#fff;text-decoration:underline">Abonnez-vous</a> pour écouter dans l\'ordre et télécharger gratuitement.'}</p>
    </div>
    <div class="recherche"><input id="cherche" type="search" placeholder="Rechercher un titre, un artiste, un genre…"></div>
    <div class="onglets" style="margin:6px 0 14px">
      <button data-tri="nouveautes" class="${(vueAccueil.tri || 'nouveautes') === 'nouveautes' ? 'actif' : ''}">Nouveautés</button>
      <button data-tri="ecoutes" class="${vueAccueil.tri === 'ecoutes' ? 'actif' : ''}">Les plus écoutés</button>
    </div>
    <div id="liste" class="liste"></div>`;

  const parAuditeurs = (a, b) => (b.nb_auditeurs || 0) - (a.nb_auditeurs || 0) || (b.nb_ecoutes || 0) - (a.nb_ecoutes || 0);
  const dessinerListe = (liste0) => {
    const classement = vueAccueil.tri === 'ecoutes';
    const liste = classement ? [...liste0].sort(parAuditeurs) : liste0;
    etat.file = liste;
    $('#liste').innerHTML = liste.length ? liste.map((t, i) => classement ? ligneClassement(t, i) : ligneTitre(t)).join('') : `
      <div class="vide"><span class="grand">♪</span>${titres.length ? 'Aucun résultat.' : 'Aucun titre publié pour le moment.<br>Les premiers chants arrivent bientôt !'}</div>`;
    brancherLignes($('#liste'));
  };
  dessinerListe(titres);
  $$('[data-tri]').forEach((b) => b.onclick = () => {
    vueAccueil.tri = b.dataset.tri;
    $$('[data-tri]').forEach((x) => x.classList.toggle('actif', x === b));
    $('#cherche').dispatchEvent(new Event('input'));
  });
  $('#cherche').oninput = (e) => {
    const q = e.target.value.trim().toLowerCase();
    dessinerListe(!q ? titres : titres.filter((t) =>
      [t.titre, t.genre, t.artistes?.nom_scene].some((v) => (v || '').toLowerCase().includes(q))));
  };
}

// Ligne du classement « Les plus écoutés » : rang + nombre d'auditeurs (un compte = une fois)
function ligneClassement(t, i) {
  const n = t.nb_auditeurs || 0;
  return ligneTitre(t)
    .replace('<div class="lt-infos">', `<div class="rang ${i < 3 ? 'podium' : ''}">${i + 1}</div><div class="lt-infos">`)
    .replace('<button class="lt-play"', `<div class="compte-auditeurs"><b>${n.toLocaleString('fr-FR')}</b><span>auditeur${n > 1 ? 's' : ''}</span></div><button class="lt-play"`);
}

function ligneTitre(t) {
  const enCours = etat.enCours?.id === t.id;
  return `
    <div class="ligne-titre ${enCours ? 'en-cours' : ''}" data-id="${t.id}">
      ${imgPochette(t.pochette_path)}
      <div class="lt-infos">
        <div class="lt-titre">${esc(t.titre)}${t.video_path ? ' <span class="badge-clip">CLIP</span>' : ''}</div>
        <div class="lt-artiste">${esc(t.artistes?.nom_scene || '')}${t.genre ? ' · ' + esc(t.genre) : ''}${t.duree_sec ? ' · ' + duree(t.duree_sec) : ''}</div>
      </div>
      <button class="lt-play" data-jouer="${t.id}" aria-label="Écouter">${enCours && !$('#audio').paused ? '❚❚' : '▶'}</button>
    </div>`;
}
function brancherLignes(racine) {
  $$('.ligne-titre', racine).forEach((l) => {
    l.onclick = (e) => {
      const id = l.dataset.id;
      const t = etat.file.find((x) => x.id === id);
      if (e.target.closest('[data-jouer]')) {
        if (etat.enCours?.id === id) basculerLecture(); else jouer(t);
      } else {
        location.hash = `#/titre/${id}`;
      }
    };
  });
}

// =========================================================
// LECTEUR
// =========================================================
const audio = $('#audio');

async function urlAudio(t) {
  // 1) Copie hors ligne (titre acheté)
  try {
    const cache = await caches.open(CACHE_HORS_LIGNE);
    const rep = await cache.match(`/hors-ligne/${t.id}`);
    if (rep) return URL.createObjectURL(await rep.blob());
  } catch (_) { /* Cache indisponible */ }
  // 2) Écoute en ligne (lien temporaire) : fichier audio, sinon le son de la vidéo
  const { data, error } = t.audio_path
    ? await sb.storage.from('audio').createSignedUrl(t.audio_path, 60 * 60 * 3)
    : await sb.storage.from('videos').createSignedUrl(t.video_path, 60 * 60 * 3);
  if (error) throw error;
  return data.signedUrl;
}

async function chargerCatalogue() {
  if (etat.catalogue.length) return etat.catalogue;
  const { data } = await sb.from('titres')
    .select('id, titre, genre, pochette_path, audio_path, video_path, duree_sec, artistes(id, nom_scene)')
    .eq('statut', 'publie').limit(500);
  etat.catalogue = data || [];
  return etat.catalogue;
}
function majModeLecture() {
  const m = $('#lecteur-mode');
  if (m) m.textContent = estAbonne() ? 'Dans l\'ordre' : 'Aléatoire';
}

async function jouer(t, depuisHistorique = false) {
  if (!t?.audio_path && !t?.video_path) return toast('Fichier introuvable.', true);
  try {
    if (!depuisHistorique && etat.enCours && etat.enCours.id !== t.id) {
      etat.historique.push(etat.enCours);
      if (etat.historique.length > 50) etat.historique.shift();
    }
    etat.enCours = t;
    afficherLecteur(t);
    $('#lecteur-bouton').textContent = '…';
    audio.src = await urlAudio(t);
    await audio.play();
    sb.rpc('compter_ecoute', { p_titre_id: t.id }).then(() => {});
    if ('mediaSession' in navigator) {
      const pochette = urlPochette(t.pochette_path);
      navigator.mediaSession.metadata = new MediaMetadata({
        title: t.titre,
        artist: t.artistes?.nom_scene || 'Mongongo Way',
        album: 'Mongongo Way',
        artwork: pochette ? [{ src: pochette, sizes: '512x512' }] : [{ src: 'icon-512.png', sizes: '512x512', type: 'image/png' }]
      });
      navigator.mediaSession.setActionHandler('nexttrack', () => suivant(1));
      navigator.mediaSession.setActionHandler('previoustrack', () => suivant(-1));
    }
  } catch (e) { erreur(e); $('#lecteur-bouton').textContent = '▶'; }
  rafraichirLignes();
}
function afficherLecteur(t) {
  document.body.classList.add('avec-lecteur');
  $('#lecteur').classList.remove('cache');
  $('#lecteur-titre').textContent = t.titre;
  $('#lecteur-artiste').textContent = t.artistes?.nom_scene || '';
  const u = urlPochette(t.pochette_path);
  const img = $('#lecteur-pochette');
  if (u) img.src = u; else img.removeAttribute('src');
}
function basculerLecture() {
  if (!audio.src) return;
  audio.paused ? audio.play() : audio.pause();
}
async function suivant(sens) {
  if (sens < 0 && etat.historique.length) return jouer(etat.historique.pop(), true);
  if (estAbonne()) {
    // Abonné : la liste choisie (artiste, album…) dans l'ordre
    const i = etat.file.findIndex((x) => x.id === etat.enCours?.id);
    const t = etat.file[i + sens];
    if (t) return jouer(t);
    return;
  }
  // Sans abonnement : lecture aléatoire dans tout le catalogue
  const cat = (await chargerCatalogue()).filter((x) => x.id !== etat.enCours?.id && (x.audio_path || x.video_path));
  if (cat.length) jouer(cat[Math.floor(Math.random() * cat.length)]);
}
function rafraichirLignes() {
  $$('.ligne-titre').forEach((l) => {
    const actif = l.dataset.id === etat.enCours?.id;
    l.classList.toggle('en-cours', actif);
    const b = $('[data-jouer]', l);
    if (b) b.textContent = actif && !audio.paused ? '❚❚' : '▶';
  });
  const bd = $('#btn-ecouter');
  if (bd) bd.textContent = (bd.dataset.id === etat.enCours?.id && !audio.paused) ? '❚❚ Pause' : '▶ Écouter';
}
$('#lecteur-bouton').onclick = basculerLecture;
$('#lecteur-titre').onclick = () => etat.enCours && (location.hash = `#/titre/${etat.enCours.id}`);
audio.addEventListener('play', () => { $('#lecteur-bouton').textContent = '❚❚'; rafraichirLignes(); });
audio.addEventListener('pause', () => { $('#lecteur-bouton').textContent = '▶'; rafraichirLignes(); });
audio.addEventListener('ended', () => suivant(1));
audio.addEventListener('timeupdate', () => {
  if (audio.duration) $('#lecteur-barre').value = (audio.currentTime / audio.duration) * 100;
});
$('#lecteur-barre').addEventListener('input', (e) => {
  if (audio.duration) audio.currentTime = (e.target.value / 100) * audio.duration;
});

// =========================================================
// DÉTAIL D'UN TITRE
// =========================================================
async function vueTitre(id) {
  chargement();
  const uid = etat.session.user.id;
  const [{ data: t, error }, { count: nbLikes }, { data: monLike }, { data: achat }, { data: coms }] = await Promise.all([
    sb.from('titres').select('*, artistes(id, nom_scene, type, biographie)').eq('id', id).maybeSingle(),
    sb.from('likes').select('*', { count: 'exact', head: true }).eq('titre_id', id),
    sb.from('likes').select('titre_id').eq('titre_id', id).eq('profil_id', uid).maybeSingle(),
    sb.from('achats').select('format').eq('titre_id', id).eq('profil_id', uid),
    sb.from('commentaires').select('id, contenu, cree_le, profil_id, profils(nom_complet)').eq('titre_id', id).order('cree_le', { ascending: false }).limit(100)
  ]);
  if (error) throw error;
  if (!t) { vue.innerHTML = `<div class="vide"><span class="grand">♪</span>Ce titre n'existe pas ou n'est plus disponible.</div>`; return; }
  if (!etat.file.some((x) => x.id === t.id)) etat.file = [t];

  const achete = { audio: false, video: false };
  (achat || []).forEach((a) => { achete[a.format || 'audio'] = true; });
  const cleHL = { audio: `/hors-ligne/${t.id}`, video: `/hors-ligne-video/${t.id}` };
  const hors = { audio: false, video: false };
  try {
    const cache = await caches.open(CACHE_HORS_LIGNE);
    hors.audio = !!(await cache.match(cleHL.audio));
    hors.video = !!(await cache.match(cleHL.video));
  } catch (_) {}
  const formats = t.video_path ? ['audio', 'video'] : ['audio'];

  const enCours = etat.enCours?.id === t.id && !audio.paused;
  vue.innerHTML = `
    <div class="detail-tete">
      ${t.video_path ? `<div class="clip" style="--ratio:${t.video_largeur && t.video_hauteur ? (t.video_largeur / t.video_hauteur).toFixed(4) : '1.7778'}"><video id="clip" controls playsinline preload="none" ${t.pochette_path ? `poster="${esc(urlPochette(t.pochette_path))}"` : ''}></video><button class="clip-lancer" id="clip-lancer">▶ Regarder le clip</button></div>` : imgPochette(t.pochette_path)}
      <h1>${esc(t.titre)}</h1>
      <div class="doux"><a href="#/a/${t.artistes?.id}">${esc(t.artistes?.nom_scene || '')}</a>${t.album ? ' · ' + esc(t.album) : ''}${t.genre ? ' · ' + esc(t.genre) : ''}</div>
      ${t.statut !== 'publie' ? `<div style="margin-top:8px"><span class="badge ${t.statut}">${STATUTS_TITRE[t.statut]}</span></div>` : ''}
      <div class="actions">
        <button class="btn" id="btn-ecouter" data-id="${t.id}">${enCours ? '❚❚ Pause' : '▶ Écouter'}</button>
        <button class="btn secondaire" id="btn-like">${monLike ? '<span class="aime">♥</span>' : '♡'} <span id="nb-likes">${nbLikes || 0}</span></button>
      </div>
      ${t.statut === 'publie' ? `<div class="actions" style="margin-top:0"><button class="btn secondaire" id="btn-telecharger">⤓ Télécharger${formats.every((f) => hors[f]) ? ' · ✓ hors ligne' : ''}</button></div>` : ''}
      ${estAdmin() && t.video_path ? `<div class="actions" style="margin-top:0"><button class="btn secondaire petit" id="btn-remplacer">⟳ Remplacer la vidéo</button><input type="file" id="fichier-remplacer" accept="video/mp4,video/webm,video/quicktime,video/3gpp,.mp4,.mov,.webm,.3gp" class="cache"></div>` : ''}
      <div class="stats"><span>${(t.nb_ecoutes || 0).toLocaleString('fr-FR')} lecture${(t.nb_ecoutes || 0) > 1 ? 's' : ''}</span><span>${(t.nb_auditeurs || 0).toLocaleString('fr-FR')} auditeur${(t.nb_auditeurs || 0) > 1 ? 's' : ''}</span>${t.duree_sec ? `<span>${duree(t.duree_sec)}</span>` : ''}${t.publie_le ? `<span>${dateCourte(t.publie_le)}</span>` : ''}</div>
    </div>

    ${t.paroles ? `<h2>Paroles</h2><div class="paroles">${esc(t.paroles)}</div>` : ''}

    ${t.statut === 'publie' ? `
    <h2>Commentaires <span class="doux petit">(${coms?.length || 0})</span></h2>
    <form class="form-commentaire" id="form-com">
      <input id="com" maxlength="1000" placeholder="Un mot pour l'artiste…" required>
      <button class="btn petit" type="submit">Envoyer</button>
    </form>
    <div id="coms">${(coms || []).map(commentaireHtml).join('') || '<p class="doux petit">Soyez le premier à commenter.</p>'}</div>` : ''}`;

  $('#btn-ecouter').onclick = () => (etat.enCours?.id === t.id ? basculerLecture() : jouer(t));

  // Administrateur : remplacer le fichier vidéo sans toucher au reste (lectures, auditeurs, pochette, paroles…)
  $('#btn-remplacer')?.addEventListener('click', () => $('#fichier-remplacer').click());
  $('#fichier-remplacer')?.addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 50 * 1024 * 1024) return toast('Vidéo trop lourde (50 Mo max.).', true);
    const info = await lireInfosVideo(f);
    ouvrirModale(`
      <h2 style="margin-top:0">Remplacer la vidéo</h2>
      <p>« ${esc(t.titre)} » · nouvelle vidéo : <b>${(f.size / 1048576).toFixed(1).replace('.', ',')} Mo</b> · ${info.largeur}×${info.hauteur} · ${duree(info.duree)}</p>
      <p class="doux petit">Envoyée telle quelle, sans compression ni perte de qualité. Restent inchangés : titre, pochette, paroles, prix, ${t.nb_ecoutes || 0} lectures, ${t.nb_auditeurs || 0} auditeurs, commentaires et j'aime.</p>
      <div class="progression" id="prog-remp"><div></div></div>
      <p class="doux petit" id="etat-remp" style="text-align:center">Prêt.</p>
      <button class="btn plein" id="ok-remp">Remplacer</button>
      <button class="btn secondaire plein" style="margin-top:10px" data-fermer>Annuler</button>`);
    $('#ok-remp').onclick = async () => {
      const b = $('#ok-remp'); b.disabled = true;
      const avancer = (x, msg) => { $('#prog-remp').firstElementChild.style.width = Math.round(x * 100) + '%'; $('#etat-remp').textContent = msg; };
      let verrou = null;
      try { verrou = await navigator.wakeLock?.request('screen'); } catch (_) {}
      try {
        const ext = (f.name.split('.').pop() || 'mp4').toLowerCase();
        const type = { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', '3gp': 'video/3gpp' }[ext] || f.type || 'video/mp4';
        const nouveau = `${etat.session.user.id}/${Date.now()}.${ext}`;
        await envoyerFichier('videos', nouveau, f, type, (x, detail) => { if (x !== null) avancer(x * 0.95, `Envoi… ${Math.round(x * 100)} %${detail ? ' · ' + detail : ''}`); });
        avancer(0.97, 'Mise à jour du titre…');
        const maj = { video_path: nouveau, video_largeur: info.largeur || null, video_hauteur: info.hauteur || null };
        if (info.duree) maj.duree_sec = Math.round(info.duree);
        const { error } = await sb.from('titres').update(maj).eq('id', t.id);
        if (error) { await sb.storage.from('videos').remove([nouveau]); throw error; }
        await sb.storage.from('videos').remove([t.video_path]); // l'ancien fichier
        avancer(1, '✓ Vidéo remplacée.');
        toast('Vidéo remplacée. Lectures, auditeurs et pochette conservés.');
        setTimeout(() => { fermerModale(); vueTitre(t.id); }, 1000);
      } catch (err) {
        erreur(err); b.disabled = false; b.textContent = 'Réessayer';
        avancer(0, 'Échec : ' + (err?.message || err));
      }
      try { verrou?.release(); } catch (_) {}
    };
  });

  let aime = !!monLike, nb = nbLikes || 0;
  $('#btn-like').onclick = async () => {
    const b = $('#btn-like'); b.disabled = true;
    const r = aime
      ? await sb.from('likes').delete().eq('titre_id', t.id).eq('profil_id', uid)
      : await sb.from('likes').insert({ titre_id: t.id, profil_id: uid });
    b.disabled = false;
    if (r.error) return erreur(r.error);
    aime = !aime; nb += aime ? 1 : -1;
    b.innerHTML = `${aime ? '<span class="aime">♥</span>' : '♡'} <span id="nb-likes">${nb}</span>`;
  };

  // Clip vidéo : lecture gratuite en ligne (ou copie hors ligne si achetée)
  $('#clip-lancer')?.addEventListener('click', async (e) => {
    const b = e.currentTarget; b.textContent = 'Chargement…';
    try {
      const v = $('#clip');
      let src = null;
      try { const r = await (await caches.open(CACHE_HORS_LIGNE)).match(cleHL.video); if (r) src = URL.createObjectURL(await r.blob()); } catch (_) {}
      if (!src) {
        const { data, error } = await sb.storage.from('videos').createSignedUrl(t.video_path, 60 * 60 * 3);
        if (error) throw error;
        src = data.signedUrl;
      }
      audio.pause();
      adapterVideo(v);
      v.src = src; b.remove();
      v.onended = () => {
        if (!estAbonne()) return toast('Abonnez-vous pour enchaîner les clips automatiquement.');
        const clips = etat.file.filter((x) => x.video_path);
        const i = clips.findIndex((x) => x.id === t.id);
        if (clips[i + 1]) regarderClips(clips, i + 1);
      };
      await v.play();
      sb.rpc('compter_ecoute', { p_titre_id: t.id }).then(() => {});
    } catch (err) { erreur(err); b.textContent = '▶ Regarder le clip'; }
  });

  // Télécharger : choix Audio (tiré de la vidéo) ou Vidéo
  $('#btn-telecharger')?.addEventListener('click', () => {
    const ligne = (f) => {
      const nom = f === 'audio' ? 'Audio (MP3)' : 'Vidéo (MP4)';
      const prix = f === 'audio' ? t.prix_telechargement : t.prix_video;
      const etatF = hors[f] ? '✓ Déjà sur ce téléphone' : achete[f] ? 'Déjà acheté' : estAbonne() ? 'Inclus dans votre abonnement' : montant(prix, t.devise);
      const note = f === 'audio' && !t.audio_path ? 'Le son est tiré de la vidéo sur votre téléphone' : f === 'audio' ? 'Le son seul, plus léger' : 'Le clip complet';
      return `<button class="carte" data-format="${f}" style="width:100%;text-align:left;cursor:pointer;color:var(--texte);font:inherit;display:flex;align-items:center;gap:12px">
        <span style="font-size:24px">${f === 'audio' ? '♪' : '▶'}</span>
        <span style="flex:1"><b>${nom}</b><br><span class="doux petit">${note}</span></span>
        <b style="color:var(--or)">${etatF}</b></button>`;
    };
    ouvrirModale(`
      <h2 style="margin-top:0">Télécharger « ${esc(t.titre)} »</h2>
      <p class="doux petit">Choisissez le format. Le fichier sera enregistré dans l'application pour une écoute sans internet.</p>
      ${formats.map(ligne).join('')}
      <div class="progression cache" id="prog-tel"><div></div></div>
      <p class="doux petit cache" id="etat-tel" style="text-align:center"></p>
      <button class="btn secondaire plein" style="margin-top:10px" data-fermer>Fermer</button>`);
    $$('#modale [data-format]').forEach((b) => b.onclick = async () => {
      const f = b.dataset.format;
      if (hors[f]) return toast(f === 'audio' ? 'L\'audio est déjà sur ce téléphone.' : 'La vidéo est déjà sur ce téléphone.');
      if (!achete[f] && !estAbonne()) { fermerModale(); return modalePaiement(t, 'telechargement', f); }
      $$('#modale [data-format]').forEach((x) => x.disabled = true);
      const prog = $('#prog-tel'), info = $('#etat-tel');
      prog.classList.remove('cache'); info.classList.remove('cache');
      const avancer = (x, msg) => { prog.firstElementChild.style.width = Math.round(x * 100) + '%'; info.textContent = msg; };
      let verrou = null;
      try { verrou = await navigator.wakeLock?.request('screen'); } catch (_) {}
      try {
        let fichier, typeF;
        if (f === 'audio' && t.audio_path) {
          avancer(0.2, 'Téléchargement de l\'audio…');
          const { data, error } = await sb.storage.from('audio').download(t.audio_path);
          if (error) throw error;
          fichier = data; typeF = data.type || 'audio/mpeg';
        } else {
          avancer(0.05, 'Téléchargement de la vidéo…');
          const { data, error } = await sb.storage.from('videos').download(t.video_path);
          if (error) throw error;
          if (f === 'video') { fichier = data; typeF = data.type || 'video/mp4'; }
          else {
            avancer(0.5, 'Extraction de l\'audio…');
            const r = await extraireAudio(data, (x) => avancer(0.5 + x * 0.45, `Extraction de l'audio… ${Math.round(x * 100)} %`));
            fichier = r.fichier; typeF = 'audio/mpeg';
          }
        }
        const cache = await caches.open(CACHE_HORS_LIGNE);
        await cache.put(cleHL[f], new Response(fichier, { headers: { 'Content-Type': typeF } }));
        hors[f] = true;
        avancer(1, f === 'audio' ? '✓ Audio enregistré : écoutez-le sans internet.' : '✓ Vidéo enregistrée : regardez-la sans internet.');
        toast(info.textContent);
        setTimeout(() => { fermerModale(); vueTitre(t.id); }, 1200);
      } catch (err) {
        erreur(err);
        avancer(0, 'Échec : ' + (err?.message || err) + ' Réessayez avec une bonne connexion.');
        $$('#modale [data-format]').forEach((x) => x.disabled = false);
      }
      try { verrou?.release(); } catch (_) {}
    });
  });

  $('#form-com')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const contenu = $('#com').value.trim();
    if (!contenu) return;
    const { data, error } = await sb.from('commentaires')
      .insert({ titre_id: t.id, profil_id: uid, contenu })
      .select('id, contenu, cree_le, profil_id, profils(nom_complet)').single();
    if (error) return erreur(error);
    $('#com').value = '';
    const zone = $('#coms');
    if (zone.querySelector('p.doux')) zone.innerHTML = '';
    zone.insertAdjacentHTML('afterbegin', commentaireHtml(data));
  });
  $('#coms')?.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-suppr]');
    if (!b) return;
    const { error } = await sb.from('commentaires').delete().eq('id', b.dataset.suppr);
    if (error) return erreur(error);
    b.closest('.commentaire').remove();
  });
}

function commentaireHtml(c) {
  const peutSuppr = c.profil_id === etat.session.user.id || estAdmin();
  return `
    <div class="commentaire">
      <a class="auteur" href="#/membre/${c.profil_id}">${esc(c.profils?.nom_complet || 'Membre')}</a><span class="date">${dateCourte(c.cree_le)}</span>
      ${peutSuppr ? `<button class="lien-bouton petit" style="float:right;color:var(--doux)" data-suppr="${c.id}">Supprimer</button>` : ''}
      <p>${esc(c.contenu)}</p>
    </div>`;
}

// Paiement Mobile Money (branché sur l'agrégateur à l'étape suivante)
function modalePaiement(t, type = 'telechargement', format = 'audio') {
  const prix = type === 'depot' ? etat.tarifs.frais_depot_titre
    : { montant: format === 'video' ? t.prix_video : t.prix_telechargement, devise: t.devise };
  ouvrirModale(`
    <h2 style="margin-top:0">${type === 'depot' ? 'Frais de dépôt' : type === 'abonnement' ? 'S\'abonner' : (format === 'video' ? 'Télécharger la vidéo' : 'Télécharger l\'audio')}</h2>
    <p class="doux">${esc(t.titre)} — <b style="color:var(--texte)">${montant(prix?.montant, prix?.devise)}</b></p>
    <label>Payer avec</label>
    <div class="operateurs">
      <label><input type="radio" name="op" value="mpesa" checked><span>M-Pesa</span></label>
      <label><input type="radio" name="op" value="orange_money"><span>Orange Money</span></label>
      <label><input type="radio" name="op" value="airtel_money"><span>Airtel Money</span></label>
    </div>
    <label for="tel-paie">Numéro Mobile Money</label>
    <input id="tel-paie" type="tel" inputmode="tel" value="${esc((etat.profil?.telephone || '').replace('+243', '0'))}">
    <button class="btn plein" id="payer">Payer ${montant(prix?.montant, prix?.devise)}</button>
    <button class="btn secondaire plein" style="margin-top:10px" data-fermer>Annuler</button>`);
  $('#payer').onclick = () => {
    toast('Le paiement Mobile Money sera activé très bientôt.');
    fermerModale();
  };
}

// =========================================================
// ESPACE ARTISTE
// =========================================================
async function vueArtiste() {
  chargement();
  await chargerProfil();
  const a = etat.artiste;

  if (!a) {
    vue.innerHTML = `
      <h1>Devenir artiste</h1>
      <p class="doux">Chantre, groupe ou chorale de Theway RDC ? Créez votre fiche pour déposer vos chants. L'administrateur la validera.</p>
      <form id="form-artiste">
        <label for="scene">Nom d'artiste / de groupe</label>
        <input id="scene" required maxlength="80" placeholder="Ex. Chorale Les Élus">
        <label for="type">Vous êtes</label>
        <select id="type"><option value="solo">Artiste solo</option><option value="groupe">Groupe</option><option value="chorale">Chorale</option></select>
        <label for="bio">Présentation (facultatif)</label>
        <textarea id="bio" maxlength="1000" placeholder="Votre parcours, votre ministère…"></textarea>
        <button class="btn plein" type="submit">Envoyer ma demande</button>
      </form>`;
    $('#form-artiste').onsubmit = async (e) => {
      e.preventDefault();
      e.submitter.disabled = true;
      const { error } = await sb.from('artistes').insert({
        profil_id: etat.session.user.id,
        nom_scene: $('#scene').value.trim(),
        type: $('#type').value,
        biographie: $('#bio').value.trim() || null
      });
      if (error) { e.submitter.disabled = false; return erreur(error); }
      toast('Demande envoyée à l\'administrateur.');
      vueArtiste();
    };
    return;
  }

  if (a.statut !== 'valide') {
    vue.innerHTML = `
      <h1>${esc(a.nom_scene)}</h1>
      <div class="carte">
        <span class="badge ${a.statut}">${STATUTS_ARTISTE[a.statut]}</span>
        <p>${a.statut === 'en_attente'
          ? 'Votre demande a bien été reçue. Dès que l\'administrateur l\'aura validée, vous pourrez déposer vos chants.'
          : 'Votre fiche artiste n\'est pas active. Contactez l\'administrateur.'}</p>
      </div>`;
    return;
  }

  const { data: titres, error } = await sb.from('titres')
    .select('*, artistes(nom_scene)').eq('artiste_id', a.id).order('cree_le', { ascending: false });
  if (error) throw error;
  const tot = (k) => titres.reduce((s, t) => s + Number(t[k] || 0), 0);
  const { data: soutiensRecus } = await sb.from('soutiens')
    .select('montant, montant_artiste, devise, message, cree_le, profils(nom_complet)')
    .eq('artiste_id', a.id).order('cree_le', { ascending: false }).limit(50);
  const sr = soutiensRecus || [];
  const totalSoutien = sr.reduce((s, x) => s + Number(x.montant_artiste || 0), 0);

  vue.innerHTML = `
    <h1>${esc(a.nom_scene)} <span class="badge valide" style="vertical-align:middle">Validé</span></h1>
    <div class="chiffres">
      <div class="chiffre"><b>${titres.filter((t) => t.statut === 'publie').length}</b><span>titres publiés</span></div>
      <div class="chiffre"><b>${tot('nb_ecoutes').toLocaleString('fr-FR')}</b><span>écoutes</span></div>
      <div class="chiffre"><b>${tot('nb_telechargements').toLocaleString('fr-FR')}</b><span>téléchargements</span></div>
    </div>
    <a class="btn plein" href="#/deposer" style="margin-top:0">＋ Déposer un nouveau titre</a>
    <h2>Soutiens reçus <span class="doux petit">(${sr.length})</span></h2>
    <div class="carte">
      <div style="display:flex;justify-content:space-between;align-items:baseline"><span class="doux">Votre part reçue</span><b style="color:var(--or);font-size:22px">${montant(totalSoutien)}</b></div>
      ${sr.slice(0, 5).map((x) => `
        <div class="commentaire"><span class="auteur">${esc(x.profils?.nom_complet || 'Un fidèle')}</span><span class="date">${dateCourte(x.cree_le)} · ${montant(x.montant_artiste, x.devise)} pour vous</span>${x.message ? `<p>« ${esc(x.message)} »</p>` : ''}</div>`).join('') || '<p class="doux petit" style="margin:8px 0 0">Aucun soutien reçu pour le moment. Les croyants peuvent vous soutenir depuis l\'onglet Soutien.</p>'}
    </div>
    <h2>Mes titres</h2>
    <div id="mes-titres">${titres.length ? titres.map(carteMonTitre).join('') : '<div class="vide">Vous n\'avez encore déposé aucun titre.</div>'}</div>`;

  $('#mes-titres').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-action]');
    if (!b) return;
    const t = titres.find((x) => x.id === b.dataset.id);
    if (b.dataset.action === 'ecouter') { etat.file = titres; return jouer(t); }
    if (b.dataset.action === 'envoyer') {
      b.disabled = true;
      const { error } = await sb.from('titres').update({ statut: 'en_attente_paiement' }).eq('id', t.id);
      if (error) { b.disabled = false; return erreur(error); }
      toast('Titre envoyé à l\'administrateur pour validation.');
      vueArtiste();
    }
    if (b.dataset.action === 'supprimer') {
      b.disabled = true;
      const { error } = await sb.from('titres').delete().eq('id', t.id);
      if (error) { b.disabled = false; return erreur(error); }
      if (t.audio_path) await sb.storage.from('audio').remove([t.audio_path]);
      if (t.pochette_path) await sb.storage.from('pochettes').remove([t.pochette_path]);
      if (t.video_path) await sb.storage.from('videos').remove([t.video_path]);
      toast('Brouillon supprimé.');
      vueArtiste();
    }
  });
}

function carteMonTitre(t) {
  const frais = etat.tarifs.frais_depot_titre;
  return `
    <div class="carte" style="display:flex;gap:12px;align-items:flex-start">
      ${imgPochette(t.pochette_path)}
      <div style="flex:1;min-width:0">
        <h3>${esc(t.titre)}${t.video_path ? ' <span class="badge-clip">CLIP</span>' : ''}</h3>
        <span class="badge ${t.statut}">${STATUTS_TITRE[t.statut]}</span>
        ${t.statut === 'refuse' && t.motif_refus ? `<p class="petit" style="color:var(--rouge)">Motif : ${esc(t.motif_refus)}</p>` : ''}
        ${t.statut === 'publie' ? `<p class="doux petit" style="margin:6px 0 0">${t.nb_ecoutes} lectures · ${t.nb_auditeurs || 0} auditeurs · ${t.nb_telechargements} téléchargements</p>` : ''}
        ${['brouillon', 'refuse'].includes(t.statut) ? `<p class="doux petit" style="margin:6px 0 0">Frais de dépôt : ${montant(frais?.montant, frais?.devise)}</p>` : ''}
        <div class="boutons">
          <button class="btn secondaire petit" data-action="ecouter" data-id="${t.id}">▶ Écouter</button>
          ${['brouillon', 'refuse'].includes(t.statut) ? `<button class="btn petit" data-action="envoyer" data-id="${t.id}">Envoyer pour validation</button>` : ''}
          ${t.statut === 'brouillon' ? `<button class="btn danger petit" data-action="supprimer" data-id="${t.id}">Supprimer</button>` : ''}
        </div>
      </div>
    </div>`;
}

// =========================================================
// DÉPÔT D'UN TITRE
// =========================================================
async function vueDeposer() {
  await chargerProfil();
  if (etat.artiste?.statut !== 'valide') { location.hash = '#/artiste'; return; }
  const prixDefaut = etat.tarifs.prix_telechargement_defaut?.montant ?? 2;
  const prixVideoDefaut = etat.tarifs.prix_video_defaut?.montant ?? 3;
  // Albums déjà utilisés par l'artiste (suggestions)
  const { data: mesAlbums } = await sb.from('titres').select('album, piste').eq('artiste_id', etat.artiste.id).not('album', 'is', null);
  const albums = [...new Set((mesAlbums || []).map((x) => x.album))].sort((a, b) => a.localeCompare(b, 'fr'));

  vue.innerHTML = `
    <h1>Déposer un titre</h1>
    <form id="form-depot">
      <label for="d-titre">Titre de la chanson</label>
      <input id="d-titre" required maxlength="120">
      <label for="d-genre">Genre</label>
      <select id="d-genre">${GENRES.map((g) => `<option>${g}</option>`).join('')}</select>

      <label for="d-video">Vidéo du chant (MP4, 50 Mo max. après compression)</label>
      <input id="d-video" type="file" accept="video/mp4,video/webm,video/quicktime,video/3gpp,.mp4,.mov,.webm,.3gp" required>
      <p class="doux petit" style="margin:6px 0 0">Publiez uniquement la vidéo. Les croyants pourront l'écouter en audio, et la télécharger en audio (le son est tiré de la vidéo) ou en vidéo.</p>
      <div id="bloc-compression" class="carte cache" style="margin:10px 0 0"></div>

      <label for="d-pochette">Pochette (image carrée, 5 Mo max., facultatif)</label>
      <input id="d-pochette" type="file" accept="image/jpeg,image/png,image/webp">

      <div style="display:grid;grid-template-columns:2fr 1fr;gap:10px">
        <div>
          <label for="d-album">Album (facultatif)</label>
          <input id="d-album" list="albums" maxlength="120" placeholder="Ex. Libala">
          <datalist id="albums">${albums.map((a) => `<option value="${esc(a)}">`).join('')}</datalist>
        </div>
        <div>
          <label for="d-piste">N° de piste</label>
          <input id="d-piste" type="number" min="1" step="1" placeholder="1">
        </div>
      </div>

      <label for="d-prix">Prix du téléchargement audio (USD)</label>
      <input id="d-prix" type="number" min="0.1" step="0.1" value="${prixDefaut}" required>
      <div id="bloc-prix-video" class="cache">
        <label for="d-prix-video">Prix du téléchargement vidéo (USD)</label>
        <input id="d-prix-video" type="number" min="0.1" step="0.1" value="${prixVideoDefaut}">
      </div>
      <label for="d-paroles">Paroles (facultatif)</label>
      <textarea id="d-paroles"></textarea>
      <div class="progression cache" id="prog"><div></div></div>
      <div id="erreur-depot" class="carte cache" style="border-color:var(--rouge);margin-top:14px"></div>
      <button class="btn plein" type="submit">Enregistrer le titre</button>
      <p class="doux petit" style="text-align:center">Le titre est d'abord enregistré en brouillon. Vous l'enverrez ensuite à l'administrateur pour validation.</p>
    </form>`;

  // Analyse de la vidéo choisie et proposition de compression
  let infoVid = null;
  $('#d-video').onchange = async () => {
    const f = $('#d-video').files[0];
    $('#bloc-prix-video').classList.toggle('cache', !f);
    const bloc = $('#bloc-compression');
    infoVid = null;
    if (!f) { bloc.classList.add('cache'); return; }
    bloc.classList.remove('cache');
    bloc.innerHTML = '<span class="doux petit">Analyse de la vidéo…</span>';
    infoVid = await lireInfosVideo(f);
    const mo = f.size / 1048576;
    const grand = Math.max(infoVid.largeur, infoVid.hauteur);
    const conseil = mo > 20 || grand > 1280;
    const estime = estimerTaille(infoVid.duree);
    const tropLourd = mo > 50;
    bloc.innerHTML = `
      <div class="petit"><b>${mo.toFixed(1).replace('.', ',')} Mo</b> · ${infoVid.largeur}×${infoVid.hauteur} · ${duree(infoVid.duree)}</div>
      <label style="display:flex;gap:10px;align-items:flex-start;color:var(--texte);margin:10px 0 0">
        <input type="radio" name="compr" value="oui" ${conseil || tropLourd ? 'checked' : ''} style="width:auto;margin-top:4px">
        <span><b>Compresser en ${grand > 1280 || infoVid.largeur > 1280 ? '720p' : 'qualité allégée'}</b>${conseil ? ' (recommandé)' : ''}<br><span class="doux petit">${infoVid.duree && estime < mo ? `Environ ${estime} Mo` : 'Fichier plus léger'} · plus rapide à envoyer et à regarder</span></span>
      </label>
      <label style="display:flex;gap:10px;align-items:flex-start;color:var(--texte);margin:8px 0 0">
        <input type="radio" name="compr" value="non" ${!conseil && !tropLourd ? 'checked' : ''} ${tropLourd ? 'disabled' : ''} style="width:auto;margin-top:4px">
        <span><b>Garder l'original</b><br><span class="doux petit">${tropLourd ? 'Impossible : plus de 50 Mo' : 'Aucune perte de qualité'}</span></span>
      </label>`;
  };
  $('#d-album').oninput = () => {
    // Propose la piste suivante de l'album choisi
    const n = (mesAlbums || []).filter((x) => x.album === $('#d-album').value.trim()).reduce((m, x) => Math.max(m, x.piste || 0), 0);
    $('#d-piste').placeholder = String(n + 1);
  };

  const horo = Date.now();
  $('#form-depot').onsubmit = async (e) => {
    e.preventDefault();
    let fVid = $('#d-video').files[0];

    const fImg = $('#d-pochette').files[0];
    if (!fVid) return toast('Choisissez la vidéo du chant.', true);
    const compresser = !!fVid && $('input[name=compr]:checked')?.value !== 'non';
    if (fVid && !compresser && fVid.size > 50 * 1024 * 1024) return toast('Vidéo trop lourde (50 Mo max.) : choisissez « Compresser ».', true);
    if (fImg && fImg.size > 5 * 1024 * 1024) return toast('Image trop lourde (5 Mo max.).', true);

    const bouton = e.submitter; bouton.disabled = true;
    const prog = $('#prog'); prog.classList.remove('cache');
    const avancer = (p, msg) => { prog.firstElementChild.style.width = p + '%'; bouton.textContent = msg; };
    const uid = etat.session.user.id;
    const etape = { nom: 'préparation' };
    $('#erreur-depot').classList.add('cache');
    let verrouEcran = null;
    try { verrouEcran = await navigator.wakeLock?.request('screen'); } catch (_) {}
    try {
      let dureeSec = null;
      if (compresser) {
        const avant = fVid.size;
        etape.nom = 'compression de la vidéo';
        avancer(2, 'Compression de la vidéo…');
        try {
          const info = infoVid || await lireInfosVideo(fVid);
          const res = await compresserVideo(fVid, info, (x, mode) => avancer(2 + Math.round(x * 28), `${mode === 'lent' ? 'Compression (gardez l\'écran allumé)' : 'Compression de la vidéo'}… ${Math.round(x * 100)} %`));
          if (res.size < avant) fVid = res;
          toast(`Vidéo compressée : ${(avant / 1048576).toFixed(0)} Mo → ${(fVid.size / 1048576).toFixed(0)} Mo`);
        } catch (err) {
          console.error(err);
          if (avant > 50 * 1024 * 1024) throw new Error('La compression a échoué sur ce téléphone. Compressez la vidéo avec une autre application (ex. CapCut, en 720p), puis réessayez.');
          toast('Compression impossible sur ce téléphone : la vidéo originale sera envoyée.');
        }
        if (fVid.size > 50 * 1024 * 1024) throw new Error('Même compressée, la vidéo dépasse 50 Mo. Raccourcissez-la ou compressez-la avec une autre application.');
      }
      // Durée lue sur la vidéo finale (après compression), sinon sur l'originale
      const infoFinale = await lireInfosVideo(fVid);
      dureeSec = Math.round(infoFinale.duree || infoVid?.duree || 0) || null;

      let cheminVid = null;
      if (fVid) {
        avancer(55, 'Envoi de la vidéo… (patientez)');
        const extV = fVid.type === 'video/webm' ? 'webm' : fVid.type === 'video/mp4' && !fVid.name ? 'mp4' : (fVid.name.split('.').pop() || 'mp4').toLowerCase();
        const typeV = { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', '3gp': 'video/3gpp' }[extV] || fVid.type || 'video/mp4';
        cheminVid = `${uid}/${horo}.${extV}`;
        etape.nom = 'envoi de la vidéo';
        let dernierPct = 55;
        avancer(55, `Envoi de la vidéo… 0 % · 0 / ${(fVid.size / 1048576).toFixed(1).replace('.', ',')} Mo (gardez l'écran allumé)`);
        await envoyerFichier('videos', cheminVid, fVid, typeV, (x, detail) => { if (x === null) return avancer(dernierPct, `Envoi de la vidéo : ${detail}`); dernierPct = 55 + Math.round(x * 28); avancer(dernierPct, `Envoi de la vidéo… ${Math.round(x * 100)} %${detail ? ' · ' + detail : ''}`); });
      }

      let cheminImg = null;
      if (fImg) {
        avancer(85, 'Envoi de la pochette…');
        const extI = (fImg.name.split('.').pop() || 'jpg').toLowerCase();
        cheminImg = `${uid}/${horo}.${extI}`;
        etape.nom = 'envoi de la pochette';
        const upI = await sb.storage.from('pochettes').upload(cheminImg, fImg, { contentType: fImg.type, upsert: true });
        if (upI.error) throw upI.error;
      }

      etape.nom = 'enregistrement du titre';
      avancer(95, 'Enregistrement…');
      const album = $('#d-album').value.trim() || null;
      const piste = Number($('#d-piste').value) || (album ? Number($('#d-piste').placeholder) || null : null);
      const { error } = await sb.from('titres').insert({
        artiste_id: etat.artiste.id,
        titre: $('#d-titre').value.trim(),
        genre: $('#d-genre').value,
        album,
        piste,
        paroles: $('#d-paroles').value.trim() || null,
        audio_path: null,
        video_path: cheminVid,
        video_largeur: infoFinale.largeur || null,
        video_hauteur: infoFinale.hauteur || null,
        pochette_path: cheminImg,
        duree_sec: dureeSec || null,
        prix_telechargement: Number($('#d-prix').value),
        prix_video: fVid ? Number($('#d-prix-video').value || prixVideoDefaut) : prixVideoDefaut,
        devise: 'USD'
      });
      if (error) throw error;
      avancer(100, 'Terminé ✓');
      try { verrouEcran?.release(); } catch (_) {}
      toast('Titre enregistré. Envoyez-le maintenant pour validation.');
      location.hash = '#/artiste';
    } catch (err) {
      erreur(err);
      const zoneErr = $('#erreur-depot');
      zoneErr.innerHTML = `<b style="color:var(--rouge)">Échec à l'étape : ${esc(etape.nom)}</b><p class="petit" style="margin:6px 0 0">${esc(err?.message || String(err))}</p><p class="doux petit" style="margin:6px 0 0">Réessayez : les fichiers déjà envoyés seront réutilisés. Si l'erreur revient, faites une capture de ce message.</p>`;
      zoneErr.classList.remove('cache');
      zoneErr.scrollIntoView({ behavior: 'smooth', block: 'center' });
      bouton.disabled = false; bouton.textContent = 'Réessayer';
      try { verrouEcran?.release(); } catch (_) {}
      prog.classList.add('cache');
    }
  };
}

// Envoi d'un fichier vers Supabase Storage.
// Au-delà de 6 Mo : envoi « résumable » par morceaux (TUS), qui reprend tout seul si la connexion coupe.
async function envoyerFichier(bucket, chemin, fichier, type, progres) {
  if (fichier.size <= 6 * 1024 * 1024) {
    progres?.(0.1);
    const { error } = await sb.storage.from(bucket).upload(chemin, fichier, { contentType: type, upsert: true });
    if (error) throw error;
    progres?.(1);
    return;
  }
  const tus = await import('https://cdn.jsdelivr.net/npm/tus-js-client@4/+esm');
  const Upload = tus.Upload || tus.default?.Upload;
  const { data: { session } } = await sb.auth.getSession();
  const ref = new URL(SUPABASE_URL).hostname.split('.')[0];
  const mo = (o) => (o / 1048576).toFixed(1).replace('.', ',');
  await new Promise((ok, ko) => {
    let dernier = Date.now(), relances = 0, fini = false;
    const envoi = new Upload(fichier, {
      endpoint: `https://${ref}.storage.supabase.co/storage/v1/upload/resumable`,
      retryDelays: [0, 3000, 5000, 10000, 20000, 30000, 60000],
      headers: { authorization: `Bearer ${session.access_token}`, apikey: SUPABASE_CLE, 'x-upsert': 'true' },
      uploadDataDuringCreation: false,
      removeFingerprintOnSuccess: true,
      metadata: { bucketName: bucket, objectName: chemin, contentType: type, cacheControl: '3600' },
      chunkSize: 6 * 1024 * 1024, // imposé par Supabase
      onError: (e) => { fini = true; clearInterval(veille); ko(new Error(traduireErreurEnvoi(e))); },
      onProgress: (fait, total) => { dernier = Date.now(); progres?.(total ? fait / total : 0, `${mo(fait)} / ${mo(total)} Mo`); },
      onChunkComplete: () => { dernier = Date.now(); },
      onSuccess: () => { fini = true; clearInterval(veille); ok(); }
    });
    // Si rien ne bouge pendant 90 s (réseau bloqué), on relance l'envoi là où il s'est arrêté
    const veille = setInterval(() => {
      if (fini || Date.now() - dernier < 90000) return;
      if (++relances > 5) {
        fini = true; clearInterval(veille); envoi.abort();
        return ko(new Error('La connexion est trop faible pour envoyer la vidéo. Essayez en Wi-Fi ou avec un meilleur réseau, puis touchez « Réessayer » : l\'envoi reprendra où il s\'est arrêté.'));
      }
      dernier = Date.now();
      progres?.(null, `connexion lente, nouvelle tentative ${relances}/5…`);
      envoi.abort().then(() => envoi.start());
    }, 5000);
    envoi.findPreviousUploads().then((prec) => {
      if (prec.length) envoi.resumeFromPreviousUpload(prec[0]);
      envoi.start();
    }).catch(() => envoi.start());
  });
}
function traduireErreurEnvoi(e) {
  const m = String(e?.message || e);
  if (/413|too large|exceeded the maximum/i.test(m)) return 'Fichier trop lourd pour le serveur (50 Mo max.).';
  if (/415|mime|content type/i.test(m)) return 'Format de fichier refusé par le serveur.';
  if (/403|401|unauthor|row-level/i.test(m)) return 'Envoi refusé : reconnectez-vous puis réessayez.';
  if (/network|failed to fetch|timeout|xhr/i.test(m)) return 'Connexion internet coupée pendant l\'envoi.';
  return m;
}

// ---------- Compression vidéo sur le téléphone ----------
function lireInfosVideo(fichier) {
  return new Promise((ok) => {
    const v = document.createElement('video');
    const u = URL.createObjectURL(fichier);
    v.preload = 'metadata'; v.muted = true;
    let fait = false;
    const fin = (r) => { if (fait) return; fait = true; URL.revokeObjectURL(u); ok(r); };
    v.onloadedmetadata = () => {
      const res = { largeur: v.videoWidth || 0, hauteur: v.videoHeight || 0, duree: isFinite(v.duration) ? v.duration : 0 };
      if (res.duree) return fin(res);
      // Certaines vidéos (WebM) n'indiquent pas leur durée : on la fait calculer en allant à la fin
      v.ontimeupdate = () => { res.duree = isFinite(v.duration) ? v.duration : 0; fin(res); };
      v.currentTime = 1e7;
      setTimeout(() => fin(res), 6000);
    };
    v.onerror = () => fin({ largeur: 0, hauteur: 0, duree: 0 });
    v.src = u;
    setTimeout(() => fin({ largeur: v.videoWidth || 0, hauteur: v.videoHeight || 0, duree: 0 }), 10000);
  });
}
// Débit visé : environ 28 Mo pour le clip, entre 450 kb/s et 2 Mb/s pour l'image
function debitVideo(dureeSec) {
  const d = Math.max(30, dureeSec || 240);
  return Math.round(Math.min(2_000_000, Math.max(450_000, (28 * 8 * 1e6) / d - 128_000)));
}
function estimerTaille(dureeSec) {
  const d = dureeSec || 240;
  return Math.max(1, Math.round(((debitVideo(d) + 128_000) * d) / 8 / 1048576));
}
// Taille cible : 720p maximum, proportions gardées, dimensions paires
function dimensionsCible(l, h) {
  if (!l || !h) return { largeur: 1280, hauteur: 720 };
  const k = Math.min(1, 1280 / Math.max(l, h), 720 / Math.min(l, h));
  const pair = (x) => Math.max(2, Math.round(x / 2) * 2);
  return { largeur: pair(l * k), hauteur: pair(h * k) };
}

async function compresserVideo(fichier, info, progres) {
  const cible = dimensionsCible(info.largeur, info.hauteur);
  const debit = debitVideo(info.duree);
  // 1) Méthode rapide : encodeur vidéo du téléphone (WebCodecs), sortie MP4 H.264
  if ('VideoEncoder' in window) {
    try {
      const mb = await import('https://cdn.jsdelivr.net/npm/mediabunny@1.61.3/+esm');
      const input = new mb.Input({ source: new mb.BlobSource(fichier), formats: mb.ALL_FORMATS });
      const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new mb.BufferTarget() });
      const conv = await mb.Conversion.init({
        input, output,
        video: { width: cible.largeur, height: cible.hauteur, fit: 'contain', codec: 'avc', bitrate: debit }
      });
      if (!conv.isValid) throw new Error('Conversion impossible : ' + JSON.stringify(conv.discardedTracks?.map((t) => t.reason)));
      conv.onProgress = (p) => progres?.(p, 'rapide');
      await conv.execute();
      return new File([output.target.buffer], 'clip.mp4', { type: 'video/mp4' });
    } catch (e) {
      console.warn('Compression rapide impossible, passage à la méthode lente', e);
    }
  }
  // 2) Méthode de secours : la vidéo est rejouée et réenregistrée (temps réel)
  return compresserTempsReel(fichier, cible, debit, progres);
}

async function compresserTempsReel(fichier, cible, debit, progres) {
  if (!('MediaRecorder' in window) || !HTMLCanvasElement.prototype.captureStream) throw new Error('Enregistrement vidéo non pris en charge');
  const type = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((t) => MediaRecorder.isTypeSupported(t));
  if (!type) throw new Error('Aucun format d\'enregistrement disponible');
  const u = URL.createObjectURL(fichier);
  const v = document.createElement('video');
  v.src = u; v.playsInline = true; v.preload = 'auto';
  await new Promise((ok, ko) => { v.onloadeddata = ok; v.onerror = () => ko(new Error('Vidéo illisible')); });
  const canvas = document.createElement('canvas');
  canvas.width = cible.largeur; canvas.height = cible.hauteur;
  const g = canvas.getContext('2d');
  // Le son passe par Web Audio vers l'enregistreur, sans sortir du haut-parleur
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const actx = new Ctx();
  const dest = actx.createMediaStreamDestination();
  actx.createMediaElementSource(v).connect(dest);
  const flux = canvas.captureStream(30);
  dest.stream.getAudioTracks().forEach((t) => flux.addTrack(t));
  const rec = new MediaRecorder(flux, { mimeType: type, videoBitsPerSecond: debit, audioBitsPerSecond: 128_000 });
  const morceaux = [];
  rec.ondataavailable = (e) => { if (e.data.size) morceaux.push(e.data); };
  const arret = new Promise((ok) => { rec.onstop = ok; });
  const dessiner = () => {
    g.drawImage(v, 0, 0, cible.largeur, cible.hauteur);
    if (v.duration) progres?.(v.currentTime / v.duration, 'lent');
    if (!v.ended) requestAnimationFrame(dessiner);
  };
  rec.start(1000);
  await actx.resume();
  await v.play();
  dessiner();
  await new Promise((ok) => { v.onended = ok; });
  rec.stop();
  await arret;
  actx.close();
  URL.revokeObjectURL(u);
  const mime = type.split(';')[0];
  return new File(morceaux, mime === 'video/webm' ? 'clip.webm' : 'clip.mp4', { type: mime });
}

// Tire l'audio d'une vidéo et l'encode en MP3 (128 kb/s), directement sur le téléphone
async function extraireAudio(fichierVideo, progres) {
  const lame = await import('https://cdn.jsdelivr.net/npm/@breezystack/lamejs@1.2.7/+esm');
  const Encodeur = lame.Mp3Encoder || lame.default?.Mp3Encoder;
  if (!Encodeur) throw new Error('Encodeur MP3 indisponible');
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx({ sampleRate: 44100 });
  let son;
  try { son = await ctx.decodeAudioData(await fichierVideo.arrayBuffer()); }
  finally { ctx.close?.(); }
  const canaux = Math.min(2, son.numberOfChannels);
  const enc = new Encodeur(canaux, son.sampleRate, 128);
  const g = son.getChannelData(0), d = canaux > 1 ? son.getChannelData(1) : null;
  const n = g.length, bloc = 1152, morceaux = [];
  const vers16 = (src, a, b) => {
    const out = new Int16Array(b - a);
    for (let i = a; i < b; i++) { const v = Math.max(-1, Math.min(1, src[i])); out[i - a] = v < 0 ? v * 0x8000 : v * 0x7fff; }
    return out;
  };
  for (let i = 0, k = 0; i < n; i += bloc, k++) {
    const f = Math.min(n, i + bloc);
    const mp3 = d ? enc.encodeBuffer(vers16(g, i, f), vers16(d, i, f)) : enc.encodeBuffer(vers16(g, i, f));
    if (mp3.length) morceaux.push(new Uint8Array(mp3));
    if (k % 300 === 0) { progres?.(i / n); await new Promise((r) => setTimeout(r, 0)); }
  }
  const fin = enc.flush();
  if (fin.length) morceaux.push(new Uint8Array(fin));
  progres?.(1);
  return { fichier: new Blob(morceaux, { type: 'audio/mpeg' }), duree: Math.round(son.duration) };
}

function lireDuree(fichier) {
  return new Promise((ok) => {
    const a = document.createElement('audio');
    const u = URL.createObjectURL(fichier);
    a.preload = 'metadata';
    a.onloadedmetadata = () => { URL.revokeObjectURL(u); ok(Math.round(a.duration) || null); };
    a.onerror = () => ok(null);
    a.src = u;
    setTimeout(() => ok(null), 8000);
  });
}

// =========================================================
// PROFIL
// =========================================================
async function vueProfil() {
  await chargerProfil();
  const p = etat.profil || {};
  const initiale = (p.nom_complet || '?').trim().charAt(0).toUpperCase();
  vue.innerHTML = `
    <div class="profil-tete">
      <div class="avatar">${esc(initiale)}</div>
      <div>
        <h1 style="margin:0">${esc(p.nom_complet || 'Membre')}</h1>
        <div class="doux">${esc(p.telephone || '')}${estAdmin() ? ' · <span style="color:var(--or)">Administrateur</span>' : ''}</div>
      </div>
    </div>
    <div class="menu">
      <a href="#/abonnement">${estAbonne() ? `Mon abonnement · jusqu'au ${dateCourte(etat.finAbo)}` : 'S\'abonner'}</a>
      <a href="#/messages">Mes messages</a>
      <a href="#/achats">Mes téléchargements</a>
      <a href="#/artiste">${etat.artiste ? 'Mon espace artiste' : 'Devenir artiste'}</a>
      ${estAdmin() ? '<a href="#/admin">Administration</a>' : ''}
      <button id="modif-nom">Modifier mon nom</button>
      <button id="choix-theme">Apparence <span class="doux" id="theme-actuel">${themeActuel() === 'jour' ? '☀ Jour' : '☾ Nuit'}</span></button>
      <button id="installer" class="cache">Installer l'application sur ce téléphone</button>
      <button id="deconnexion" style="color:var(--rouge)">Se déconnecter</button>
    </div>
    <div class="apropos">
      <img src="icon-192.png" width="40" height="40" alt="" style="border-radius:10px"><br>
      <b style="color:var(--texte)">Mongongo Way</b> · version 1.0<br>
      La plateforme musicale des musiciens de Theway RDC<br>
      Conçue et développée par <b style="color:var(--texte)">Ingénieur Van MUFWAR</b>
    </div>`;

  $('#choix-theme').onclick = () => { basculerTheme(); $('#theme-actuel').textContent = themeActuel() === 'jour' ? '☀ Jour' : '☾ Nuit'; };
  $('#deconnexion').onclick = async () => { audio.pause(); await sb.auth.signOut(); };
  $('#modif-nom').onclick = () => {
    ouvrirModale(`
      <h2 style="margin-top:0">Modifier mon nom</h2>
      <input id="nouveau-nom" value="${esc(p.nom_complet || '')}" maxlength="80">
      <button class="btn plein" id="ok-nom">Enregistrer</button>`);
    $('#ok-nom').onclick = async () => {
      const { error } = await sb.from('profils').update({ nom_complet: $('#nouveau-nom').value.trim() }).eq('id', p.id);
      if (error) return erreur(error);
      fermerModale(); toast('Nom mis à jour.'); vueProfil();
    };
  };
  if (window.__installation) {
    const b = $('#installer');
    b.classList.remove('cache');
    b.onclick = async () => { window.__installation.prompt(); window.__installation = null; b.classList.add('cache'); };
  }
}

async function vueAchats() {
  chargement();
  const { data, error } = await sb.from('achats')
    .select('cree_le, format, titres(id, titre, genre, pochette_path, audio_path, video_path, duree_sec, artistes(nom_scene))')
    .eq('profil_id', etat.session.user.id).order('cree_le', { ascending: false });
  if (error) throw error;
  const vus = new Set();
  const titres = (data || []).map((a) => a.titres).filter((t) => t && !vus.has(t.id) && vus.add(t.id));
  vue.innerHTML = `<h1>Mes téléchargements</h1><div id="liste" class="liste"></div>`;
  etat.file = titres;
  $('#liste').innerHTML = titres.length ? titres.map(ligneTitre).join('') : '<div class="vide"><span class="grand">⤓</span>Vous n\'avez encore téléchargé aucun titre.</div>';
  brancherLignes($('#liste'));
}

// =========================================================
// ADMINISTRATION
// =========================================================
async function vueAdmin(onglet = 'artistes') {
  if (!estAdmin()) { location.hash = '#/profil'; return; }
  chargement();
  const [{ data: artistes }, { data: titres }, { data: tarifs }, { count: nbMembres }, { count: nbPublies }, { data: pubsAttente }] = await Promise.all([
    sb.from('artistes').select('*, profils(nom_complet, telephone)').eq('statut', 'en_attente').order('cree_le'),
    sb.from('titres').select('*, artistes(nom_scene)').in('statut', ['en_attente_paiement', 'en_validation']).order('cree_le'),
    sb.from('tarifs').select('*').order('cle'),
    sb.from('profils').select('*', { count: 'exact', head: true }),
    sb.from('titres').select('*', { count: 'exact', head: true }).eq('statut', 'publie'),
    sb.from('publications').select('*, profils!auteur_id(nom_complet, telephone)').eq('statut', 'en_attente').order('cree_le')
  ]);

  vue.innerHTML = `
    <h1>Administration</h1>
    <div class="chiffres">
      <div class="chiffre"><b>${nbMembres ?? 0}</b><span>membres</span></div>
      <div class="chiffre"><b>${nbPublies ?? 0}</b><span>titres publiés</span></div>
      <div class="chiffre"><b>${(artistes?.length || 0) + (titres?.length || 0) + (pubsAttente?.length || 0)}</b><span>à valider</span></div>
    </div>
    <div class="onglets" style="margin-top:0">
      <button data-o="artistes" class="${onglet === 'artistes' ? 'actif' : ''}">Artistes (${artistes?.length || 0})</button>
      <button data-o="titres" class="${onglet === 'titres' ? 'actif' : ''}">Titres (${titres?.length || 0})</button>
      <button data-o="publications" class="${onglet === 'publications' ? 'actif' : ''}">Publications (${pubsAttente?.length || 0})</button>
      <button data-o="membres" class="${onglet === 'membres' ? 'actif' : ''}">Membres</button>
      <button data-o="ecoutes" class="${onglet === 'ecoutes' ? 'actif' : ''}">Écoutes</button>
      <button data-o="soutiens" class="${onglet === 'soutiens' ? 'actif' : ''}">Soutiens</button>
      <button data-o="tarifs" class="${onglet === 'tarifs' ? 'actif' : ''}">Tarifs</button>
    </div>
    <div id="admin-contenu" style="margin-top:14px"></div>`;
  $$('.onglets button').forEach((b) => b.onclick = () => vueAdmin(b.dataset.o));
  const zone = $('#admin-contenu');

  if (onglet === 'artistes') {
    zone.innerHTML = artistes?.length ? artistes.map((a) => `
      <div class="carte">
        <h3>${esc(a.nom_scene)} <span class="badge">${esc(a.type)}</span></h3>
        <div class="doux petit">${esc(a.profils?.nom_complet || '')} · ${esc(a.profils?.telephone || '')} · demandé le ${dateCourte(a.cree_le)}</div>
        ${a.biographie ? `<p>${esc(a.biographie)}</p>` : ''}
        <div class="boutons">
          <button class="btn petit" data-artiste="${a.id}" data-statut="valide">✓ Valider</button>
          <button class="btn danger petit" data-artiste="${a.id}" data-statut="refuse">Refuser</button>
        </div>
      </div>`).join('') : '<div class="vide">Aucune demande d\'artiste en attente.</div>';
    zone.onclick = async (e) => {
      const b = e.target.closest('[data-artiste]');
      if (!b) return;
      b.disabled = true;
      const { error } = await sb.from('artistes').update({ statut: b.dataset.statut }).eq('id', b.dataset.artiste);
      if (error) { b.disabled = false; return erreur(error); }
      toast(b.dataset.statut === 'valide' ? 'Artiste validé.' : 'Demande refusée.');
      vueAdmin('artistes');
    };
  }

  if (onglet === 'titres') {
    etat.file = titres || [];
    zone.innerHTML = titres?.length ? titres.map((t) => `
      <div class="carte">
        <div style="display:flex;gap:12px">
          ${imgPochette(t.pochette_path)}
          <div style="flex:1;min-width:0">
            <h3>${esc(t.titre)}</h3>
            <div class="doux petit">${esc(t.artistes?.nom_scene || '')} · ${esc(t.genre || '')} · ${duree(t.duree_sec)} · audio ${montant(t.prix_telechargement, t.devise)}${t.video_path ? ` · vidéo ${montant(t.prix_video, t.devise)}` : ''}</div>
            <span class="badge ${t.statut}">${STATUTS_TITRE[t.statut]}</span>
          </div>
        </div>
        ${t.paroles ? `<details style="margin-top:10px"><summary class="doux petit">Voir les paroles</summary><div class="paroles" style="margin-top:8px">${esc(t.paroles)}</div></details>` : ''}
        <div class="boutons">
          <button class="btn secondaire petit" data-ecouter="${t.id}">▶ Écouter</button>
          ${t.video_path ? `<button class="btn secondaire petit" data-clip="${t.id}">▶ Voir le clip</button>` : ''}
          <button class="btn petit" data-titre="${t.id}" data-statut="publie">✓ Publier</button>
          <button class="btn danger petit" data-titre="${t.id}" data-statut="refuse">Refuser</button>
        </div>
        <div class="motif cache" data-motif="${t.id}">
          <label>Motif du refus (visible par l'artiste)</label>
          <input placeholder="Ex. qualité audio insuffisante">
          <button class="btn danger petit" style="margin-top:8px" data-confirmer-refus="${t.id}">Confirmer le refus</button>
        </div>
      </div>`).join('') : '<div class="vide">Aucun titre à valider.</div>';
    zone.onclick = async (e) => {
      const ec = e.target.closest('[data-ecouter]');
      if (ec) return jouer(titres.find((x) => x.id === ec.dataset.ecouter));
      const cl = e.target.closest('[data-clip]');
      if (cl) {
        const tc = titres.find((x) => x.id === cl.dataset.clip);
        const { data: u, error: eu } = await sb.storage.from('videos').createSignedUrl(tc.video_path, 3600);
        if (eu) return erreur(eu);
        audio.pause();
        ouvrirModale(`<h2 style="margin-top:0">${esc(tc.titre)}</h2><video class="video-adaptee" src="${esc(u.signedUrl)}" controls autoplay playsinline></video><button class="btn secondaire plein" data-fermer>Fermer</button>`);
        return;
      }
      const b = e.target.closest('[data-titre]');
      if (b && b.dataset.statut === 'refuse') return $(`[data-motif="${b.dataset.titre}"]`).classList.remove('cache');
      const cr = e.target.closest('[data-confirmer-refus]');
      const id = b?.dataset.titre || cr?.dataset.confirmerRefus;
      if (!id) return;
      const maj = cr
        ? { statut: 'refuse', motif_refus: $(`[data-motif="${id}"] input`).value.trim() || null }
        : { statut: 'publie', motif_refus: null };
      (b || cr).disabled = true;
      const { error } = await sb.from('titres').update(maj).eq('id', id);
      if (error) { (b || cr).disabled = false; return erreur(error); }
      toast(maj.statut === 'publie' ? 'Titre publié : il est visible par tous.' : 'Titre refusé.');
      vueAdmin('titres');
    };
  }

  if (onglet === 'publications') {
    const p0 = pubsAttente || [];
    zone.innerHTML = p0.length ? p0.map((p) => `
      <div class="carte" data-mod="${p.id}">
        <div class="doux petit">${p.type === 'evenement' ? '📅 Événement' : '✦ Publication'} · ${esc(p.profils?.nom_complet || '')} · ${esc(p.profils?.telephone || '')} · ${momentPrecis(p.cree_le)}</div>
        ${p.type === 'evenement' ? `<h3 style="margin:8px 0 2px">${esc(p.evt_titre)}</h3><div class="doux petit">${dateEvenement(p.evt_date)}${p.evt_lieu ? ' · ' + esc(p.evt_lieu) : ''}</div>` : ''}
        ${p.texte ? `<p class="pub-texte">${texteRiche(p.texte)}</p>` : ''}
        ${galerie(p)}
        <div class="boutons">
          <button class="btn petit" data-valider="${p.id}">✓ Valider</button>
          <button class="btn danger petit" data-refuser="${p.id}">Refuser</button>
        </div>
        <div class="motif cache"><label>Motif du refus (visible par l'auteur)</label><input placeholder="Ex. contenu hors sujet">
          <button class="btn danger petit" style="margin-top:8px" data-confirmer="${p.id}">Confirmer le refus</button></div>
      </div>`).join('') : '<div class="vide">Aucune publication à valider.</div>';
    zone.onclick = async (e) => {
      const r = e.target.closest('[data-refuser]');
      if (r) return $('.motif', r.closest('[data-mod]')).classList.remove('cache');
      const v = e.target.closest('[data-valider]'), c = e.target.closest('[data-confirmer]');
      const b = v || c; if (!b) return;
      const carte = b.closest('[data-mod]');
      const maj = v ? { statut: 'publie', motif_refus: null } : { statut: 'refuse', motif_refus: $('.motif input', carte).value.trim() || null };
      b.disabled = true;
      const { error } = await sb.from('publications').update(maj).eq('id', carte.dataset.mod);
      if (error) { b.disabled = false; return erreur(error); }
      toast(v ? 'Publication validée : visible par tous.' : 'Publication refusée.');
      vueAdmin('publications');
    };
  }

  if (onglet === 'membres') {
    const { data: membres, error: e3 } = await sb.rpc('liste_membres');
    if (e3) throw e3;
    const roles = { croyant: 'Croyant', artiste: 'Artiste', admin: 'Administrateur' };
    const quand = (d) => {
      if (!d) return 'jamais';
      const min = Math.round((Date.now() - new Date(d)) / 60000);
      if (min < 1) return 'à l\'instant';
      if (min < 60) return `il y a ${min} min`;
      if (min < 1440) return `il y a ${Math.round(min / 60)} h`;
      return `le ${dateCourte(d)}`;
    };
    const recent = (d) => Date.now() - new Date(d) < 7 * 864e5;
    const liste = membres || [];
    const nbEnLigne = liste.filter((m) => estEnLigne(m.derniere_activite)).length;
    zone.innerHTML = `
      <p class="doux petit" style="margin-top:0">${liste.length} membre${liste.length > 1 ? 's' : ''} (vous exclu) · <span class="en-ligne">● ${nbEnLigne} en ligne</span> · les plus récemment actifs en premier.</p>
      <div class="recherche"><input id="cherche-membre" type="search" placeholder="Rechercher un nom ou un numéro…"></div>
      <div id="liste-membres"></div>`;
    const dessiner = (l) => {
      $('#liste-membres').innerHTML = l.length ? l.map((m) => `
        <div class="carte" style="display:flex;gap:12px;align-items:center;padding:12px 14px">
          <div class="avatar petit-avatar">${esc((m.nom_complet || '?').charAt(0).toUpperCase())}</div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:600">${esc(m.nom_complet || 'Sans nom')} ${recent(m.inscrit_le) ? '<span class="badge en_attente">Nouveau</span>' : ''}</div>
            <div class="doux petit">${esc(m.telephone || '')} · ${m.role === 'admin' ? 'Administrateur' : m.nom_artiste ? 'Artiste' : 'Croyant'}${m.nom_artiste ? ' (' + esc(m.nom_artiste) + ')' : ''}</div>
            <div class="petit" style="margin-top:2px">${estEnLigne(m.derniere_activite)
              ? '<span class="en-ligne">● En ligne</span>'
              : `<span class="doux">Dernière connexion : ${momentPrecis(m.derniere_activite)}${m.derniere_activite ? ` (${quand(m.derniere_activite)})` : ''}</span>`}</div>
            <div class="doux petit">Inscrit le ${dateCourte(m.inscrit_le)}</div>
            <div class="petit" style="margin-top:4px">${m.abonne_jusqu_au ? `<span class="badge valide">Abonné jusqu'au ${dateCourte(m.abonne_jusqu_au)}</span>` : '<span class="badge">Non abonné</span>'}
              <button class="lien-bouton petit" data-abonner="${m.id}" style="margin-left:8px">${m.abonne_jusqu_au ? 'Prolonger' : 'Activer un abonnement'}</button></div>
          </div>
        </div>`).join('') : '<div class="vide">Aucun membre pour le moment.</div>';
    };
    dessiner(liste);
    clearTimeout(vueAdmin._rafraichir);
    vueAdmin._rafraichir = setTimeout(() => { if (location.hash.startsWith('#/admin/membres') && !$('#cherche-membre')?.value && $('#modale').classList.contains('cache')) vueAdmin('membres'); }, 60000);
    $('#liste-membres').onclick = (e) => {
      const b = e.target.closest('[data-abonner]');
      if (!b) return;
      const m = liste.find((x) => x.id === b.dataset.abonner);
      ouvrirModale(`
        <h2 style="margin-top:0">Abonnement de ${esc(m.nom_complet || 'ce membre')}</h2>
        <p class="doux petit">À utiliser pour un paiement reçu en main propre, un abonnement offert ou un test. ${m.abonne_jusqu_au ? 'La durée s\'ajoute à l\'abonnement en cours.' : ''}</p>
        ${Object.entries(FORMULES).map(([k, f]) => `<button class="btn secondaire plein" data-formule="${k}" style="margin-top:10px">${f.nom} · ${montant(prixFormule(k))}</button>`).join('')}
        <button class="btn secondaire plein" style="margin-top:10px" data-fermer>Annuler</button>`);
      $$('[data-formule]').forEach((bf) => bf.onclick = async () => {
        bf.disabled = true;
        const { data: fin, error: ea } = await sb.rpc('accorder_abonnement', { p_profil: m.id, p_formule: bf.dataset.formule });
        if (ea) { bf.disabled = false; return erreur(ea); }
        fermerModale();
        toast(`Abonnement actif jusqu'au ${dateCourte(fin)}.`);
        vueAdmin('membres');
      });
    };
    $('#cherche-membre').oninput = (e) => {
      const q = sansAccent(e.target.value.trim());
      dessiner(!q ? liste : liste.filter((m) => sansAccent(m.nom_complet).includes(q) || (m.telephone || '').includes(q)));
    };
  }

  if (onglet === 'ecoutes') {
    const { data: tit, error: e4 } = await sb.from('titres')
      .select('id, titre, nb_ecoutes, nb_auditeurs, pochette_path, artistes(nom_scene)')
      .eq('statut', 'publie').order('nb_auditeurs', { ascending: false }).order('nb_ecoutes', { ascending: false }).limit(300);
    if (e4) throw e4;
    zone.innerHTML = `
      <p class="doux petit" style="margin-top:0">Auditeurs = comptes différents (un numéro compté une seule fois). Lectures = toutes les ouvertures. Touchez un titre pour voir qui l'écoute.</p>
      ${(tit || []).map((t, i) => `
        <button class="carte" data-auditeurs="${t.id}" style="width:100%;display:flex;gap:12px;align-items:center;text-align:left;cursor:pointer;color:var(--texte);font:inherit">
          <div class="rang ${i < 3 ? 'podium' : ''}">${i + 1}</div>
          ${imgPochette(t.pochette_path)}
          <div style="flex:1;min-width:0"><b>${esc(t.titre)}</b><div class="doux petit">${esc(t.artistes?.nom_scene || '')}</div></div>
          <div class="compte-auditeurs"><b>${(t.nb_auditeurs || 0).toLocaleString('fr-FR')}</b><span>auditeurs</span></div>
          <div class="compte-auditeurs"><b>${(t.nb_ecoutes || 0).toLocaleString('fr-FR')}</b><span>lectures</span></div>
        </button>`).join('') || '<div class="vide">Aucun titre publié.</div>'}`;
    zone.onclick = async (e) => {
      const b = e.target.closest('[data-auditeurs]');
      if (!b) return;
      const t = tit.find((x) => x.id === b.dataset.auditeurs);
      ouvrirModale('<div class="chargement">Chargement…</div>');
      const { data: aud, error: e5 } = await sb.rpc('ecoutes_du_titre', { p_titre_id: t.id });
      if (e5) { fermerModale(); return erreur(e5); }
      ouvrirModale(`
        <h2 style="margin-top:0">${esc(t.titre)}</h2>
        <p class="doux petit">${(aud || []).length} auditeur${(aud || []).length > 1 ? 's' : ''} · ${t.nb_ecoutes} lectures · du plus assidu au moins assidu</p>
        ${(aud || []).map((a, i) => `
          <div style="display:flex;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid var(--ligne)">
            <div class="rang ${i < 3 ? 'podium' : ''}">${i + 1}</div>
            <div style="flex:1;min-width:0"><b>${esc(a.nom_complet || 'Sans nom')}</b>
              <div class="doux petit">${esc(a.telephone || '')} · ${a.role === 'admin' ? 'Administrateur' : 'Membre'} · dernière écoute ${momentPrecis(a.derniere)}</div></div>
            <div class="compte-auditeurs"><b>${a.nb}</b><span>fois</span></div>
          </div>`).join('') || '<p class="doux">Personne n\'a encore écouté ce titre depuis la mise en place du comptage.</p>'}
        <button class="btn secondaire plein" data-fermer>Fermer</button>`);
    };
  }

  if (onglet === 'soutiens') {
    const { data: sts, error: e2 } = await sb.from('soutiens')
      .select('montant, montant_artiste, montant_plateforme, devise, message, cree_le, artistes(nom_scene), profils(nom_complet)')
      .order('cree_le', { ascending: false }).limit(200);
    if (e2) throw e2;
    const somme = (k) => (sts || []).reduce((t, x) => t + Number(x[k] || 0), 0);
    zone.innerHTML = `
      <div class="chiffres">
        <div class="chiffre"><b>${montant(somme('montant'))}</b><span>soutiens reçus</span></div>
        <div class="chiffre"><b>${montant(somme('montant_artiste'))}</b><span>part des artistes</span></div>
        <div class="chiffre"><b>${montant(somme('montant_plateforme'))}</b><span>part de l'administration</span></div>
      </div>
      ${(sts || []).map((x) => `
        <div class="carte">
          <h3>${esc(x.artistes?.nom_scene || 'Artiste')} · ${montant(x.montant, x.devise)}</h3>
          <div class="doux petit">De ${esc(x.profils?.nom_complet || 'un fidèle')} · ${dateCourte(x.cree_le)} · artiste ${montant(x.montant_artiste, x.devise)} · administration ${montant(x.montant_plateforme, x.devise)}</div>
          ${x.message ? `<p>« ${esc(x.message)} »</p>` : ''}
        </div>`).join('') || '<div class="vide">Aucun soutien pour le moment.</div>'}`;
  }

  if (onglet === 'tarifs') {
    const libelles = {
      frais_depot_titre: 'Frais de dépôt par titre ($)',
      prix_telechargement_defaut: 'Prix du téléchargement audio par défaut ($)',
      prix_video_defaut: 'Prix du téléchargement vidéo par défaut ($)',
      part_artiste_pourcent: 'Part de l\'artiste sur un téléchargement (%)',
      part_artiste_soutien_pourcent: 'Part de l\'artiste sur un soutien (%) — le reste revient à l\'administration',
      soutien_minimum: 'Montant minimum d\'un soutien ($)',
      abonnement_mensuel: 'Abonnement 1 mois ($)',
      abonnement_trimestriel: 'Abonnement 3 mois ($)',
      abonnement_annuel: 'Abonnement 1 an ($)'
    };
    zone.innerHTML = `
      <form id="form-tarifs" class="carte">
        ${(tarifs || []).map((t) => `
          <label for="tarif-${t.cle}">${esc(libelles[t.cle] || t.description || t.cle)}</label>
          <input id="tarif-${t.cle}" data-cle="${t.cle}" type="number" min="0" step="0.01" value="${t.montant}">`).join('')}
        <button class="btn plein" type="submit">Enregistrer les tarifs</button>
      </form>`;
    $('#form-tarifs').onsubmit = async (e) => {
      e.preventDefault();
      e.submitter.disabled = true;
      for (const inp of $$('[data-cle]', zone)) {
        const { error } = await sb.from('tarifs').update({ montant: Number(inp.value) }).eq('cle', inp.dataset.cle);
        if (error) { e.submitter.disabled = false; return erreur(error); }
      }
      e.submitter.disabled = false;
      toast('Tarifs enregistrés.');
    };
  }
}

// =========================================================
// PAGE D'UN ARTISTE (albums dans l'ordre)
// =========================================================
async function vuePageArtiste(id) {
  chargement();
  const [{ data: a, error }, { data: titres, error: e2 }] = await Promise.all([
    sb.from('artistes').select('id, nom_scene, type, biographie, profil_id').eq('id', id).maybeSingle(),
    sb.from('titres').select('id, titre, genre, album, piste, pochette_path, audio_path, video_path, duree_sec, publie_le, artistes(id, nom_scene)')
      .eq('artiste_id', id).eq('statut', 'publie')
  ]);
  if (error) throw error;
  if (e2) throw e2;
  if (!a) { vue.innerHTML = '<div class="vide">Artiste introuvable.</div>'; return; }
  const types = { solo: 'Artiste solo', groupe: 'Groupe', chorale: 'Chorale' };
  // Albums : par nom, pistes dans l'ordre ; « Singles » à la fin
  const groupes = {};
  (titres || []).forEach((t) => { (groupes[t.album || ''] ||= []).push(t); });
  const noms = Object.keys(groupes).sort((x, y) => (x === '') - (y === '') || x.localeCompare(y, 'fr'));
  noms.forEach((n) => groupes[n].sort((x, y) => (x.piste || 999) - (y.piste || 999) || new Date(x.publie_le) - new Date(y.publie_le)));
  const ordre = noms.flatMap((n) => groupes[n]);
  const abo = estAbonne();
  const verrou = abo ? '' : ' 🔒';

  vue.innerHTML = `
    <div class="profil-tete">
      <div class="avatar">${esc(a.nom_scene.charAt(0).toUpperCase())}</div>
      <div><h1 style="margin:0">${esc(a.nom_scene)}</h1><div class="doux">${types[a.type] || ''} · ${ordre.length} titre${ordre.length > 1 ? 's' : ''}</div></div>
    </div>
    ${a.biographie ? `<p class="doux">${esc(a.biographie)}</p>` : ''}
    <div class="actions" style="justify-content:flex-start">
      <button class="btn" data-tout="audio">▶ Tout écouter dans l'ordre${verrou}</button>
      ${ordre.some((t) => t.video_path) ? `<button class="btn secondaire" data-tout="video">▶ Clips à la suite${verrou}</button>` : ''}
      ${a.profil_id !== etat.session.user.id ? `<button class="btn secondaire" data-soutenir>♥ Soutenir</button><a class="btn secondaire" href="#/messages/${a.profil_id}">✉ Message</a>` : ''}
    </div>
    ${!abo ? '<p class="doux petit">Sans abonnement, la lecture se poursuit au hasard. <a href="#/abonnement">S\'abonner</a> pour écouter dans l\'ordre et enchaîner les clips.</p>' : ''}
    ${noms.map((n) => `
      <h2>${n ? esc(n) : 'Singles'} ${abo ? `<button class="lien-bouton petit" data-album="${esc(n)}" style="margin-left:6px">▶ Lire</button>` : ''}</h2>
      <div class="liste" data-groupe="${esc(n)}">${groupes[n].map(ligneTitre).join('')}</div>`).join('') || '<div class="vide">Aucun titre publié pour le moment.</div>'}`;

  $$('.liste[data-groupe]').forEach((l) => {
    brancherLignes(l);
    // Un abonné qui lance un titre continue dans l'ordre de l'artiste
    l.addEventListener('click', () => { if (abo) etat.file = ordre; }, true);
  });
  etat.file = ordre;
  vue.querySelectorAll('[data-tout]').forEach((b) => b.onclick = () => {
    if (!abo) { location.hash = '#/abonnement'; return toast('Fonction réservée aux abonnés.'); }
    if (b.dataset.tout === 'audio') { etat.file = ordre; if (ordre[0]) jouer(ordre[0]); }
    else { const clips = ordre.filter((t) => t.video_path); if (clips[0]) regarderClips(clips, 0); }
  });
  vue.querySelectorAll('[data-album]').forEach((b) => b.onclick = () => {
    etat.file = groupes[b.dataset.album] || [];
    if (etat.file[0]) jouer(etat.file[0]);
  });
  $('[data-soutenir]')?.addEventListener('click', () => modaleSoutien(a));
}

// Lecteur de clips plein écran : vidéo après vidéo (abonnés)
async function regarderClips(clips, index) {
  const t = clips[index];
  if (!t) return fermerModale();
  audio.pause();
  try {
    let src = null;
    try { const r = await (await caches.open(CACHE_HORS_LIGNE)).match(`/hors-ligne-video/${t.id}`); if (r) src = URL.createObjectURL(await r.blob()); } catch (_) {}
    if (!src) {
      const { data, error } = await sb.storage.from('videos').createSignedUrl(t.video_path, 60 * 60 * 3);
      if (error) throw error;
      src = data.signedUrl;
    }
    ouvrirModale(`
      <div class="doux petit">${index + 1} / ${clips.length}${estAbonne() ? ' · clips à la suite' : ''}</div>
      <h2 style="margin:4px 0 10px">${esc(t.titre)} <span class="doux petit">· ${esc(t.artistes?.nom_scene || '')}</span></h2>
      <video id="clip-plein" class="video-adaptee" src="${esc(src)}" controls autoplay playsinline></video>
      <div class="actions">
        <button class="btn secondaire petit" id="clip-prec" ${index === 0 ? 'disabled' : ''}>⏮ Précédent</button>
        <button class="btn secondaire petit" data-fermer>Fermer</button>
        <button class="btn petit" id="clip-suiv" ${index >= clips.length - 1 ? 'disabled' : ''}>Suivant ⏭</button>
      </div>`);
    sb.rpc('compter_ecoute', { p_titre_id: t.id }).then(() => {});
    const v = $('#clip-plein');
    v.onended = () => {
      if (!estAbonne()) return toast('Abonnez-vous pour enchaîner les clips automatiquement.');
      regarderClips(clips, index + 1);
    };
    $('#clip-prec').onclick = () => regarderClips(clips, index - 1);
    $('#clip-suiv').onclick = () => regarderClips(clips, index + 1);
  } catch (e) { erreur(e); }
}

// =========================================================
// ABONNEMENT
// =========================================================
async function vueAbonnement() {
  await chargerProfil();
  const abo = estAbonne();
  const avantages = [
    'Écoute dans l\'ordre : par artiste ou par album',
    'Clips vidéo à la suite, sans interruption',
    'Téléchargements audio et vidéo gratuits',
    'Écoute hors ligne de tous les titres enregistrés'
  ];
  vue.innerHTML = `
    <div class="banniere">
      <h1>Abonnement Mongongo Way</h1>
      <p>${abo ? `Votre abonnement est actif jusqu'au <b>${dateCourte(etat.finAbo)}</b>.` : 'Sans abonnement : écoute gratuite en lecture aléatoire, téléchargements payants.'}</p>
    </div>
    <div class="carte">
      <h3>Avec l'abonnement</h3>
      ${avantages.map((x) => `<div style="display:flex;gap:10px;margin-top:8px"><span style="color:var(--or)">✓</span><span>${x}</span></div>`).join('')}
    </div>
    <h2>Choisir une formule</h2>
    ${Object.entries(FORMULES).map(([k, f]) => {
      const prix = prixFormule(k);
      const parMois = k === 'mensuel' ? '' : ` · soit ${montant(prix / (k === 'annuel' ? 12 : 3))} par mois`;
      return `<div class="carte" style="display:flex;align-items:center;gap:12px">
        <div style="flex:1"><h3>${f.nom}</h3><div class="doux petit">${montant(prix)}${parMois}</div></div>
        <button class="btn petit" data-formule="${k}">${abo ? 'Prolonger' : 'S\'abonner'}</button>
      </div>`;
    }).join('')}`;
  vue.querySelectorAll('[data-formule]').forEach((b) => b.onclick = () => {
    const k = b.dataset.formule;
    modalePaiement({ titre: `Abonnement ${FORMULES[k].nom}`, prix_telechargement: prixFormule(k), devise: 'USD' }, 'abonnement');
  });
}

// =========================================================
// FIL : ACTUALITÉS ET ÉVÉNEMENTS (validés par l'administrateur)
// =========================================================
const urlImagePub = (p) => (p ? sb.storage.from('publications').getPublicUrl(p).data.publicUrl : '');
const dateEvenement = (d) => new Date(d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + ' à ' + new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const texteRiche = (t) => esc(t || '').replace(/\n/g, '<br>');

async function vueFil(onglet = 'actualites') {
  chargement();
  const uid = etat.session.user.id;
  const type = onglet === 'evenements' ? 'evenement' : 'message';
  const [{ data: pubs, error }, { data: mesJaimes }] = await Promise.all([
    sb.from('publications').select('*, profils!auteur_id(nom_complet)').eq('type', type)
      .or(`statut.eq.publie,auteur_id.eq.${uid}`)
      .order(type === 'evenement' ? 'evt_date' : 'cree_le', { ascending: type === 'evenement' }).limit(200),
    sb.from('publication_jaimes').select('publication_id').eq('profil_id', uid)
  ]);
  if (error) throw error;
  const aimes = new Set((mesJaimes || []).map((x) => x.publication_id));
  const maintenant = Date.now();
  let liste = pubs || [];
  let html = '';
  if (type === 'message') {
    // Mes publications en attente d'abord, puis le fil du plus récent au plus ancien
    liste = [...liste.filter((p) => p.statut !== 'publie'), ...liste.filter((p) => p.statut === 'publie').sort((a, b) => new Date(b.publie_le) - new Date(a.publie_le))];
    html = liste.map((p) => cartePublication(p, aimes)).join('') || '<div class="vide"><span class="grand">✦</span>Aucune publication pour le moment. Soyez le premier à partager !</div>';
  } else {
    const aVenir = liste.filter((p) => new Date(p.evt_date).getTime() >= maintenant - 6 * 3600e3);
    const passes = liste.filter((p) => new Date(p.evt_date).getTime() < maintenant - 6 * 3600e3).reverse();
    html = (aVenir.map((p) => carteEvenement(p, aimes)).join('') || '<div class="vide"><span class="grand">📅</span>Aucun événement à venir pour le moment.</div>')
      + (passes.length ? `<h2>Événements passés</h2>${passes.map((p) => carteEvenement(p, aimes, true)).join('')}` : '');
  }

  vue.innerHTML = `
    <div class="onglets" style="margin-top:0">
      <button data-fil="actualites" class="${type === 'message' ? 'actif' : ''}">Actualités</button>
      <button data-fil="evenements" class="${type === 'evenement' ? 'actif' : ''}">Événements</button>
    </div>
    ${type === 'message' ? `
    <form class="carte composeur" id="form-pub">
      <div style="display:flex;gap:12px">
        <div class="avatar petit-avatar">${esc((etat.profil?.nom_complet || '?').charAt(0).toUpperCase())}</div>
        <textarea id="pub-texte" maxlength="3000" placeholder="Partagez une nouvelle, un témoignage, une parole…" style="min-height:70px"></textarea>
      </div>
      <div id="pub-apercu" class="apercu-photos"></div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;gap:10px">
        <label class="lien-photo">📷 Photos<input type="file" id="pub-image" accept="image/*" multiple class="cache"></label>
        <button class="btn petit" type="submit">Publier</button>
      </div>
      ${estAdmin() ? '' : '<p class="doux petit" style="margin:8px 0 0">Votre publication sera visible par tous après validation par l\'administrateur.</p>'}
    </form>` : `
    <button class="btn plein" id="btn-annoncer" style="margin:0 0 14px">＋ Annoncer un événement</button>
    <form class="carte cache" id="form-evt">
      <h3>Nouvel événement</h3>
      <label for="evt-titre">Titre</label><input id="evt-titre" required maxlength="150" placeholder="Ex. Grand concert de louange">
      <div class="deux-col">
        <div><label for="evt-date">Date et heure</label><input id="evt-date" type="datetime-local" required></div>
        <div><label for="evt-lieu">Lieu</label><input id="evt-lieu" maxlength="200" placeholder="Ex. Église Theway, Kinshasa"></div>
      </div>
      <label for="evt-texte">Description</label><textarea id="evt-texte" maxlength="3000" placeholder="Programme, artistes, entrée…"></textarea>
      <label>Affiche et photos (facultatif, ${MAX_PHOTOS} max.)</label>
      <label class="lien-photo" style="display:inline-block;margin:0">📷 Choisir des photos<input type="file" id="evt-image" accept="image/*" multiple class="cache"></label>
      <div id="evt-apercu" class="apercu-photos"></div>
      <button class="btn plein" type="submit">${estAdmin() ? 'Publier l\'événement' : 'Envoyer pour validation'}</button>
    </form>`}
    <div id="fil">${html}</div>`;

  $$('[data-fil]').forEach((b) => b.onclick = () => { location.hash = `#/fil/${b.dataset.fil}`; });

  // Photos choisies (une ou plusieurs), réduites avant envoi
  const photosPub = selecteurPhotos($('#pub-image'), $('#pub-apercu'));
  const photosEvt = selecteurPhotos($('#evt-image'), $('#evt-apercu'));
  const envoyerImages = async (fichiers, bouton) => {
    const chemins = [];
    for (let i = 0; i < fichiers.length; i++) {
      if (fichiers.length > 1) bouton.textContent = `Envoi des photos ${i + 1}/${fichiers.length}…`;
      const f = fichiers[i];
      if (f.size > 5 * 1024 * 1024) throw new Error('Une photo est trop lourde (5 Mo max.).');
      const chemin = `${uid}/${Date.now()}-${i}.${f.type === 'image/png' ? 'png' : f.type === 'image/webp' ? 'webp' : 'jpg'}`;
      let e;
      try {
        ({ error: e } = await Promise.race([
          sb.storage.from('publications').upload(chemin, f, { contentType: f.type || 'image/jpeg', upsert: true }),
          new Promise((_, ko) => setTimeout(() => ko(new Error('délai dépassé')), 120000))
        ]));
      } catch (x) { e = x; }
      if (e) {
        if (chemins.length) sb.storage.from('publications').remove(chemins);
        const m = e.message || String(e);
        throw new Error(/fetch|délai|network/i.test(m)
          ? `La photo ${i + 1} n'a pas pu être envoyée (connexion trop faible ou coupée). Réessayez.`
          : `Envoi de la photo ${i + 1} impossible : ${m}`);
      }
      chemins.push(chemin);
    }
    return chemins;
  };
  const apresEnvoi = () => toast(estAdmin() ? 'Publié.' : 'Envoyé ! Visible par tous après validation de l\'administrateur.');

  $('#form-pub')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const texte = $('#pub-texte').value.trim(), fichiers = photosPub.fichiers();
    if (!texte && !fichiers.length) return toast('Écrivez un message ou ajoutez une photo.', true);
    const b = e.submitter, libelle = b.textContent; b.disabled = true;
    try {
      const images = await envoyerImages(fichiers, b);
      const { error: e2 } = await sb.from('publications').insert({ auteur_id: uid, type: 'message', texte: texte || null, images, image_path: images[0] || null });
      if (e2) { if (images.length) sb.storage.from('publications').remove(images); throw e2; }
      apresEnvoi(); vueFil('actualites');
    } catch (err) { erreur(err); b.disabled = false; b.textContent = libelle; }
  });
  $('#btn-annoncer')?.addEventListener('click', () => { $('#form-evt').classList.toggle('cache'); });
  $('#form-evt')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = e.submitter, libelle = b.textContent; b.disabled = true;
    try {
      const d = new Date($('#evt-date').value);
      if (isNaN(d)) throw new Error('Choisissez la date et l\'heure.');
      const images = await envoyerImages(photosEvt.fichiers(), b);
      const { error: e2 } = await sb.from('publications').insert({
        auteur_id: uid, type: 'evenement', evt_titre: $('#evt-titre').value.trim(), evt_date: d.toISOString(),
        evt_lieu: $('#evt-lieu').value.trim() || null, texte: $('#evt-texte').value.trim() || null, images, image_path: images[0] || null
      });
      if (e2) { if (images.length) sb.storage.from('publications').remove(images); throw e2; }
      apresEnvoi(); vueFil('evenements');
    } catch (err) { erreur(err); b.disabled = false; b.textContent = libelle; }
  });

  // J'aime, commentaires, suppression
  $('#fil').onclick = async (e) => {
    const carte = e.target.closest('[data-pub]');
    if (!carte) return;
    const id = carte.dataset.pub;
    const p = liste.find((x) => x.id === id);
    const ph = e.target.closest('[data-photo]');
    if (ph) return visionneuse(photosDe(p), Number(ph.dataset.photo));
    if (e.target.closest('[data-jaime]')) {
      if (p.statut !== 'publie') return toast('Disponible après validation.');
      const b = e.target.closest('[data-jaime]'); b.disabled = true;
      const r = aimes.has(id)
        ? await sb.from('publication_jaimes').delete().eq('publication_id', id).eq('profil_id', uid)
        : await sb.from('publication_jaimes').insert({ publication_id: id, profil_id: uid });
      b.disabled = false;
      if (r.error) return erreur(r.error);
      if (aimes.has(id)) { aimes.delete(id); p.nb_jaime = Math.max(0, p.nb_jaime - 1); } else { aimes.add(id); p.nb_jaime++; }
      b.innerHTML = `${aimes.has(id) ? '<span class="aime">♥</span>' : '♡'} ${p.nb_jaime}`;
    }
    if (e.target.closest('[data-com]')) {
      if (p.statut !== 'publie') return toast('Disponible après validation.');
      const zone = $('.zone-com', carte);
      if (!zone.classList.toggle('cache')) await chargerCommentaires(p, zone);
    }
    if (e.target.closest('[data-suppr-pub]')) {
      ouvrirModale(`<h2 style="margin-top:0">Supprimer cette publication ?</h2><p class="doux">Elle sera retirée du fil pour tout le monde.</p>
        <button class="btn danger plein" id="ok-suppr">Supprimer</button><button class="btn secondaire plein" style="margin-top:10px" data-fermer>Annuler</button>`);
      $('#ok-suppr').onclick = async () => {
        const { error: e3 } = await sb.from('publications').delete().eq('id', id);
        if (e3) return erreur(e3);
        if (photosDe(p).length) await sb.storage.from('publications').remove(photosDe(p));
        fermerModale(); toast('Publication supprimée.'); carte.remove();
      };
    }
  };
}

async function chargerCommentaires(p, zone) {
  zone.innerHTML = '<div class="doux petit">Chargement…</div>';
  const { data, error } = await sb.from('publication_commentaires').select('id, contenu, cree_le, profil_id, profils(nom_complet)')
    .eq('publication_id', p.id).order('cree_le', { ascending: true }).limit(200);
  if (error) return erreur(error);
  const uid = etat.session.user.id;
  const ligne = (c) => `<div class="commentaire"><a class="auteur" href="#/membre/${c.profil_id}">${esc(c.profils?.nom_complet || 'Membre')}</a><span class="date">${momentPrecis(c.cree_le)}</span>
    ${c.profil_id === uid || estAdmin() ? `<button class="lien-bouton petit" style="float:right;color:var(--doux)" data-suppr-com="${c.id}">Supprimer</button>` : ''}<p>${texteRiche(c.contenu)}</p></div>`;
  zone.innerHTML = `${(data || []).map(ligne).join('')}
    <form class="form-commentaire"><input maxlength="1000" placeholder="Écrire un commentaire…" required><button class="btn petit" type="submit">Envoyer</button></form>`;
  $('form', zone).onsubmit = async (e) => {
    e.preventDefault();
    const inp = $('input', zone), contenu = inp.value.trim();
    if (!contenu) return;
    const { data: c, error: e2 } = await sb.from('publication_commentaires').insert({ publication_id: p.id, profil_id: uid, contenu })
      .select('id, contenu, cree_le, profil_id, profils(nom_complet)').single();
    if (e2) return erreur(e2);
    inp.value = '';
    $('form', zone).insertAdjacentHTML('beforebegin', ligne(c));
    p.nb_commentaires++;
    const b = zone.closest('[data-pub]').querySelector('[data-com]'); if (b) b.textContent = `💬 ${p.nb_commentaires}`;
  };
  zone.onclick = async (e) => {
    const b = e.target.closest('[data-suppr-com]');
    if (!b) return;
    const { error: e3 } = await sb.from('publication_commentaires').delete().eq('id', b.dataset.supprCom);
    if (e3) return erreur(e3);
    b.closest('.commentaire').remove();
  };
}

function enteteAuteur(p) {
  return `<div class="pub-entete">
    <div class="avatar petit-avatar">${esc((p.profils?.nom_complet || '?').charAt(0).toUpperCase())}</div>
    <div style="flex:1;min-width:0"><a class="nom-auteur" href="#/membre/${p.auteur_id}">${esc(p.profils?.nom_complet || 'Membre')}</a><div class="doux petit">${momentPrecis(p.publie_le || p.cree_le)}</div></div>
    ${boutonSupprPub(p)}
  </div>
  ${badgeStatutPub(p)}`;
}
const boutonSupprPub = (p) => (p.auteur_id === etat.session.user.id || estAdmin() ? `<button class="lien-bouton petit" style="color:var(--doux)" data-suppr-pub title="Supprimer">🗑</button>` : '');
function badgeStatutPub(p) {
  if (p.statut === 'en_attente') return '<div class="badge en_attente" style="margin-top:8px">En attente de validation · visible par vous seul</div>';
  if (p.statut === 'refuse') return `<div class="badge refuse" style="margin-top:8px">Refusée${p.motif_refus ? ' : ' + esc(p.motif_refus) : ''}</div>`;
  return '';
}
function piedReactions(p, aimes) {
  return `<div class="pub-actions">
      <button class="btn secondaire petit" data-jaime>${aimes.has(p.id) ? '<span class="aime">♥</span>' : '♡'} ${p.nb_jaime}</button>
      <button class="btn secondaire petit" data-com>💬 ${p.nb_commentaires}</button>
    </div>
    <div class="zone-com cache"></div>`;
}
function cartePublication(p, aimes) {
  return `<article class="carte pub" data-pub="${p.id}">
    ${enteteAuteur(p)}
    ${p.texte ? `<p class="pub-texte">${texteRiche(p.texte)}</p>` : ''}
    ${galerie(p)}
    ${piedReactions(p, aimes)}
  </article>`;
}
function carteEvenement(p, aimes, passe = false) {
  const d = new Date(p.evt_date);
  return `<article class="carte pub evenement ${passe ? 'passe' : ''}" data-pub="${p.id}">
    ${galerie(p)}
    <div style="display:flex;gap:14px;align-items:flex-start;margin-top:${photosDe(p).length ? '12px' : '0'}">
      <div class="date-evt"><b>${d.getDate()}</b><span>${d.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', '')}</span></div>
      <div style="flex:1;min-width:0">
        <h3 style="margin:0">${esc(p.evt_titre)}</h3>
        <div class="doux petit" style="margin-top:4px">📅 ${dateEvenement(p.evt_date)}${p.evt_lieu ? `<br>📍 ${esc(p.evt_lieu)}` : ''}</div>
      </div>
    </div>
    ${p.texte ? `<p class="pub-texte">${texteRiche(p.texte)}</p>` : ''}
    <div class="doux petit" style="margin-top:8px;display:flex;justify-content:space-between;align-items:center"><span>Annoncé par <a href="#/membre/${p.auteur_id}">${esc(p.profils?.nom_complet || 'un membre')}</a></span>${boutonSupprPub(p)}</div>
    ${badgeStatutPub(p)}
    ${piedReactions(p, aimes)}
  </article>`;
}

// =========================================================
// APPARENCE : MODE NUIT (par défaut) / MODE JOUR
// =========================================================
function themeActuel() { return document.documentElement.dataset.theme === 'jour' ? 'jour' : 'nuit'; }
function appliquerTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('mw-theme', t); } catch (_) {}
  $('meta[name=theme-color]')?.setAttribute('content', t === 'jour' ? '#f6f2ea' : '#141022');
  const b = $('#btn-theme');
  if (b) { b.textContent = t === 'jour' ? '☾' : '☀'; b.title = t === 'jour' ? 'Passer en mode nuit' : 'Passer en mode jour'; }
}
function basculerTheme() { appliquerTheme(themeActuel() === 'jour' ? 'nuit' : 'jour'); }
appliquerTheme(themeActuel());
$('#btn-theme')?.addEventListener('click', basculerTheme);

// =========================================================
// PHOTOS MULTIPLES DES PUBLICATIONS
// =========================================================
const MAX_PHOTOS = 10;
const photosDe = (p) => (p?.images?.length ? p.images : p?.image_path ? [p.image_path] : []);

// Réduit une photo (1600 px max., JPEG) pour un envoi rapide ; garde l'original en cas d'échec
async function reduireImage(f) {
  try {
    if (!/^image\/(jpeg|png|webp|heic|heif)/.test(f.type) && !/\.(jpe?g|png|webp|heic)$/i.test(f.name)) return f;
    const bmp = await createImageBitmap(f);
    const max = 1600, r = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (r === 1 && f.size < 1.5 * 1024 * 1024 && f.type !== 'image/heic') { bmp.close?.(); return f; }
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * r); c.height = Math.round(bmp.height * r);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close?.();
    const blob = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.85));
    return blob && blob.size < f.size ? new File([blob], 'photo.jpg', { type: 'image/jpeg' }) : f;
  } catch (_) { return f; }
}

// Prépare une photo dès qu'elle est choisie : copie en mémoire, réduite et convertie en JPEG
async function preparerPhoto(f) {
  const brut = new Blob([await f.arrayBuffer()], { type: f.type || 'image/jpeg' }); // lecture immédiate (sinon erreur)
  let img;
  try { img = await createImageBitmap(brut); } catch (_) {
    img = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error('Format de photo non pris en charge')); i.src = URL.createObjectURL(brut); });
  }
  const l = img.width || img.naturalWidth, h = img.height || img.naturalHeight;
  const r = Math.min(1, 1600 / Math.max(l, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(l * r)); c.height = Math.max(1, Math.round(h * r));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  img.close?.();
  const jpeg = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.85));
  if (jpeg && jpeg.size > 0) return new File([jpeg], 'photo.jpg', { type: 'image/jpeg' });
  if (/^image\/(jpeg|png|webp)$/.test(brut.type)) return new File([brut], 'photo', { type: brut.type });
  throw new Error('Photo illisible');
}

// Sélecteur : on peut choisir plusieurs photos, en ajouter encore, et en retirer une
function selecteurPhotos(input, zone) {
  let liste = [];
  if (!input || !zone) return { fichiers: () => [] };
  const dessiner = () => {
    zone.innerHTML = liste.map((x, i) => `<div class="vignette"><img src="${x.url}" alt=""><button type="button" data-retirer="${i}" title="Retirer">×</button></div>`).join('')
      + (liste.length ? `<div class="doux petit nb-photos">${liste.length}/${MAX_PHOTOS} photo${liste.length > 1 ? 's' : ''}</div>` : '');
  };
  input.addEventListener('change', async () => {
    // On lit les photos TOUT DE SUITE : sur certains Android, le fichier choisi n'est plus lisible au moment de l'envoi
    const choisis = [...input.files].filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name) || !f.type);
    const place = MAX_PHOTOS - liste.length;
    if (choisis.length > place) toast(`${MAX_PHOTOS} photos maximum par publication.`, true);
    const aLire = choisis.slice(0, Math.max(0, place));
    if (!aLire.length) { input.value = ''; return; }
    zone.insertAdjacentHTML('beforeend', '<div class="doux petit nb-photos" data-lecture>Préparation des photos…</div>');
    let illisibles = 0;
    for (const f of aLire) {
      try { const pret = await preparerPhoto(f); liste.push({ f: pret, url: URL.createObjectURL(pret) }); }
      catch (e) { console.error(e); illisibles++; }
    }
    input.value = '';
    dessiner();
    if (illisibles) toast(illisibles > 1 ? `${illisibles} photos n'ont pas pu être lues. Choisissez-les depuis « Fichiers » ou « Galerie ».` : 'Cette photo n\'a pas pu être lue. Choisissez-la depuis « Fichiers » ou « Galerie ».', true);
  });
  zone.addEventListener('click', (e) => {
    const b = e.target.closest('[data-retirer]');
    if (!b) return;
    URL.revokeObjectURL(liste[+b.dataset.retirer].url);
    liste.splice(+b.dataset.retirer, 1);
    dessiner();
  });
  return { fichiers: () => liste.map((x) => x.f) };
}

// Affichage en mosaïque (1, 2, 3, 4 et plus)
function galerie(p) {
  const ph = photosDe(p);
  if (!ph.length) return '';
  const vis = ph.slice(0, 4), reste = ph.length - vis.length;
  if (ph.length === 1) return `<img class="pub-image" data-photo="0" src="${esc(urlImagePub(ph[0]))}" alt="" loading="lazy">`;
  return `<div class="galerie g${vis.length}">${vis.map((x, i) => `<div class="g-case" data-photo="${i}"><img src="${esc(urlImagePub(x))}" alt="" loading="lazy">${i === 3 && reste > 0 ? `<span class="g-plus">+${reste}</span>` : ''}</div>`).join('')}</div>`;
}

// Visionneuse plein écran : précédente / suivante, glisser du doigt
function visionneuse(photos, i = 0) {
  if (!photos.length) return;
  const fond = document.createElement('div');
  fond.className = 'visionneuse';
  document.body.appendChild(fond);
  const montrer = () => {
    fond.innerHTML = `<img src="${esc(urlImagePub(photos[i]))}" alt="">
      <button class="v-fermer" title="Fermer">×</button>
      ${photos.length > 1 ? `<button class="v-prec" title="Précédente">‹</button><button class="v-suiv" title="Suivante">›</button><div class="v-compte">${i + 1} / ${photos.length}</div>` : ''}`;
  };
  const aller = (d) => { i = (i + d + photos.length) % photos.length; montrer(); };
  const fermer = () => { fond.remove(); document.removeEventListener('keydown', clavier); };
  const clavier = (e) => { if (e.key === 'Escape') fermer(); if (e.key === 'ArrowLeft') aller(-1); if (e.key === 'ArrowRight') aller(1); };
  document.addEventListener('keydown', clavier);
  fond.addEventListener('click', (e) => {
    if (e.target.closest('.v-prec')) return aller(-1);
    if (e.target.closest('.v-suiv')) return aller(1);
    if (e.target.closest('.v-fermer') || e.target === fond) fermer();
  });
  let x0 = null;
  fond.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  fond.addEventListener('touchend', (e) => { if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 50 && photos.length > 1) aller(dx < 0 ? 1 : -1); x0 = null; });
  montrer();
}

// =========================================================
// MESSAGES PRIVÉS
// =========================================================
let minuterieConversation = null;
async function majBadgeMessages() {
  const pastille = $('#badge-msg');
  if (!pastille) return;
  if (!etat.session) { pastille.classList.add('cache'); return; }
  const { data } = await sb.rpc('nb_messages_non_lus');
  const n = Number(data || 0);
  pastille.textContent = n > 99 ? '99+' : String(n);
  pastille.classList.toggle('cache', !n);
}
setInterval(() => { if (document.visibilityState === 'visible') majBadgeMessages(); }, 60000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') majBadgeMessages(); });

function momentMessage(d) {
  const j = new Date(d), maintenant = new Date();
  if (j.toDateString() === maintenant.toDateString()) return j.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return j.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

async function vueMessages(autre) {
  if (autre) return vueConversation(autre);
  chargement();
  const { data: convs, error } = await sb.rpc('mes_conversations');
  if (error) throw error;
  vue.innerHTML = `
    <h1>Messages</h1>
    <div class="recherche"><input id="cherche-dest" type="search" placeholder="Écrire à… (rechercher un membre par son nom)"></div>
    <div id="resultats-dest" class="liste cache" style="margin-bottom:14px"></div>
    <div id="liste-convs" class="liste liste-simple">${(convs || []).map((c) => `
      <a class="ligne-titre conv ${c.non_lus ? 'non-lu' : ''}" href="#/messages/${c.autre_id}">
        <div class="avatar petit-avatar">${esc((c.nom_complet || '?').charAt(0).toUpperCase())}</div>
        <div class="lt-infos">
          <div class="lt-titre">${esc(c.nom_complet || 'Membre')}</div>
          <div class="lt-artiste">${c.dernier_de_moi ? 'Vous : ' : ''}${esc(c.dernier_contenu)}</div>
        </div>
        <div class="conv-droite"><span class="doux petit">${momentMessage(c.dernier_le)}</span>${c.non_lus ? `<span class="pastille">${c.non_lus}</span>` : ''}</div>
      </a>`).join('') || '<div class="vide"><span class="grand">✉</span>Aucun message pour le moment.<br>Recherchez un membre ci-dessus, ou touchez le nom d\'une personne dans le Fil pour lui écrire.</div>'}</div>`;

  let t = null;
  $('#cherche-dest').oninput = (e) => {
    clearTimeout(t);
    const q = e.target.value.trim(), zone = $('#resultats-dest');
    if (q.length < 2) { zone.classList.add('cache'); return; }
    t = setTimeout(async () => {
      const { data, error: e2 } = await sb.from('profils').select('id, nom_complet').ilike('nom_complet', `%${q.replace(/[%_,()]/g, ' ')}%`)
        .neq('id', etat.session.user.id).order('nom_complet').limit(20);
      if (e2) return erreur(e2);
      zone.classList.remove('cache');
      zone.innerHTML = (data || []).map((m) => `
        <a class="ligne-titre" href="#/messages/${m.id}"><div class="avatar petit-avatar">${esc((m.nom_complet || '?').charAt(0).toUpperCase())}</div>
        <div class="lt-infos"><div class="lt-titre">${esc(m.nom_complet || 'Membre')}</div></div><span class="btn petit">✉ Écrire</span></a>`).join('')
        || '<div class="vide" style="padding:14px">Aucun membre trouvé.</div>';
    }, 300);
  };
}

async function vueConversation(autre) {
  const uid = etat.session.user.id;
  if (autre === uid) { location.hash = '#/messages'; return; }
  chargement();
  const { data: p, error } = await sb.from('profils').select('id, nom_complet').eq('id', autre).maybeSingle();
  if (error) throw error;
  if (!p) { vue.innerHTML = '<div class="vide">Membre introuvable.</div>'; return; }
  vue.innerHTML = `
    <div class="conv-entete">
      <a href="#/messages" class="lien-bouton" style="font-size:22px" title="Retour">‹</a>
      <a href="#/membre/${p.id}" class="conv-qui"><div class="avatar petit-avatar">${esc((p.nom_complet || '?').charAt(0).toUpperCase())}</div><b>${esc(p.nom_complet || 'Membre')}</b></a>
    </div>
    <div id="fil-messages" class="fil-messages"><div class="doux petit" style="text-align:center">Chargement…</div></div>
    <form id="form-msg" class="form-msg">
      <textarea id="msg-texte" maxlength="2000" rows="1" placeholder="Écrire un message…" required></textarea>
      <button class="btn" type="submit" title="Envoyer">➤</button>
    </form>
    <p class="doux petit" style="text-align:center;margin-top:6px">🔒 Conversation privée : visible seulement par vous deux.</p>`;

  let messages = [];
  const bulle = (m) => `<div class="bulle ${m.expediteur_id === uid ? 'moi' : 'lui'}" data-msg="${m.id}">
      <div class="bulle-texte">${texteRiche(m.contenu)}</div>
      <div class="bulle-heure">${momentPrecis(m.cree_le)}${m.expediteur_id === uid ? (m.lu_le ? ' · Lu' : ' · Envoyé') : ''}</div>
    </div>`;
  const charger = async (defiler) => {
    const { data, error: e2 } = await sb.from('messages').select('*')
      .or(`and(expediteur_id.eq.${uid},destinataire_id.eq.${autre}),and(expediteur_id.eq.${autre},destinataire_id.eq.${uid})`)
      .order('cree_le', { ascending: false }).limit(200);
    if (e2) return erreur(e2);
    const nouveaux = (data || []).reverse();
    const change = nouveaux.length !== messages.length || nouveaux.some((m, i) => m.id !== messages[i]?.id || m.lu_le !== messages[i]?.lu_le);
    messages = nouveaux;
    const zone = $('#fil-messages');
    if (!zone) return;
    if (change || defiler) {
      const enBas = zone.scrollHeight - zone.scrollTop - zone.clientHeight < 80;
      zone.innerHTML = messages.map(bulle).join('') || `<div class="vide" style="padding:20px"><span class="grand">✉</span>Écrivez le premier message à ${esc(p.nom_complet || 'ce membre')}.</div>`;
      if (defiler || enBas) zone.scrollTop = zone.scrollHeight;
    }
    if (messages.some((m) => m.destinataire_id === uid && !m.lu_le)) { await sb.rpc('marquer_messages_lus', { autre }); majBadgeMessages(); }
  };
  await charger(true);
  clearInterval(minuterieConversation);
  minuterieConversation = setInterval(() => { if (document.visibilityState === 'visible' && $('#fil-messages')) charger(false); }, 8000);

  const ta = $('#msg-texte');
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; });
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && matchMedia('(min-width: 900px)').matches) { e.preventDefault(); $('#form-msg').requestSubmit(); } });
  $('#form-msg').onsubmit = async (e) => {
    e.preventDefault();
    const contenu = ta.value.trim();
    if (!contenu) return;
    const b = e.submitter || $('#form-msg button'); b.disabled = true;
    const { error: e2 } = await sb.from('messages').insert({ expediteur_id: uid, destinataire_id: autre, contenu });
    b.disabled = false;
    if (e2) return erreur(e2);
    ta.value = ''; ta.style.height = 'auto'; ta.focus();
    await charger(true);
  };
  $('#fil-messages').onclick = (e) => {
    const bl = e.target.closest('.bulle.moi');
    if (!bl) return;
    ouvrirModale(`<h2 style="margin-top:0">Supprimer ce message ?</h2><p class="doux">Il disparaîtra aussi chez ${esc(p.nom_complet || 'le destinataire')}.</p>
      <button class="btn danger plein" id="ok-suppr-msg">Supprimer</button><button class="btn secondaire plein" style="margin-top:10px" data-fermer>Annuler</button>`);
    $('#ok-suppr-msg').onclick = async () => {
      const { error: e3 } = await sb.from('messages').delete().eq('id', bl.dataset.msg);
      if (e3) return erreur(e3);
      fermerModale(); charger(true);
    };
  };
}

// Page d'un membre : son nom, sa page artiste éventuelle, et le bouton « Envoyer un message »
async function vueMembre(id) {
  if (id === etat.session.user.id) { location.hash = '#/profil'; return; }
  chargement();
  const [{ data: p, error }, { data: art }] = await Promise.all([
    sb.from('profils').select('id, nom_complet, role, cree_le').eq('id', id).maybeSingle(),
    sb.from('artistes').select('id, nom_scene').eq('profil_id', id).eq('statut', 'valide').maybeSingle()
  ]);
  if (error) throw error;
  if (!p) { vue.innerHTML = '<div class="vide">Membre introuvable.</div>'; return; }
  vue.innerHTML = `
    <div class="profil-tete">
      <div class="avatar">${esc((p.nom_complet || '?').charAt(0).toUpperCase())}</div>
      <div><h1 style="margin:0">${esc(p.nom_complet || 'Membre')}</h1>
        <div class="doux">${p.role === 'admin' ? 'Administrateur' : art ? 'Artiste' : 'Croyant'} · membre depuis ${dateCourte(p.cree_le)}</div></div>
    </div>
    <div class="actions" style="justify-content:flex-start">
      <a class="btn" href="#/messages/${p.id}">✉ Envoyer un message</a>
      ${art ? `<a class="btn secondaire" href="#/a/${art.id}">♪ Voir sa page artiste</a>` : ''}
    </div>`;
}

// =========================================================
// SOUTIEN AUX ARTISTES
// =========================================================
const sansAccent = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

async function vueSoutien() {
  chargement();
  await chargerProfil();
  const { data, error } = await sb.from('artistes')
    .select('id, nom_scene, type, biographie, profil_id, titres(count)')
    .eq('statut', 'valide');
  if (error) throw error;
  const artistes = (data || []).sort((a, b) => a.nom_scene.localeCompare(b.nom_scene, 'fr', { sensitivity: 'base' }));
  const types = { solo: 'Artiste solo', groupe: 'Groupe', chorale: 'Chorale' };

  vue.innerHTML = `
    <div class="banniere">
      <h1>Soutenir un artiste</h1>
      <p>Encouragez les musiciens de Theway RDC par un don Mobile Money.</p>
    </div>
    <div class="recherche"><input id="cherche-artiste" type="search" placeholder="Rechercher un artiste, un groupe, une chorale…"></div>
    <div id="liste-artistes" class="liste"></div>`;

  const dessiner = (liste) => {
    let lettre = '';
    $('#liste-artistes').innerHTML = liste.length ? liste.map((a) => {
      const l = sansAccent(a.nom_scene).charAt(0).toUpperCase();
      const entete = l !== lettre ? `<div class="lettre">${esc(l)}</div>` : '';
      lettre = l;
      const nb = a.titres?.[0]?.count || 0;
      return `${entete}
        <div class="ligne-titre" data-artiste="${a.id}">
          <div class="avatar petit-avatar">${esc(a.nom_scene.charAt(0).toUpperCase())}</div>
          <div class="lt-infos">
            <div class="lt-titre">${esc(a.nom_scene)}</div>
            <div class="lt-artiste">${types[a.type] || ''} · ${nb} titre${nb > 1 ? 's' : ''}</div>
          </div>
          <button class="btn petit" data-soutenir="${a.id}">♥ Soutenir</button>
        </div>`;
    }).join('') : `<div class="vide"><span class="grand">♥</span>${artistes.length ? 'Aucun artiste ne correspond.' : 'Aucun artiste validé pour le moment.'}</div>`;
  };
  dessiner(artistes);
  $('#cherche-artiste').oninput = (e) => {
    const q = sansAccent(e.target.value.trim());
    dessiner(!q ? artistes : artistes.filter((a) => sansAccent(a.nom_scene).includes(q)));
  };
  $('#liste-artistes').onclick = (e) => {
    const l = e.target.closest('[data-artiste]');
    if (!l) return;
    const a = artistes.find((x) => x.id === l.dataset.artiste);
    if (a.profil_id === etat.session.user.id) return toast('Vous ne pouvez pas vous soutenir vous-même.', true);
    modaleSoutien(a);
  };
}

function modaleSoutien(a) {
  const part = Number(etat.tarifs.part_artiste_soutien_pourcent?.montant ?? 90);
  const mini = Number(etat.tarifs.soutien_minimum?.montant ?? 1);
  const choix = [1, 2, 5, 10].filter((v) => v >= mini);
  let valeur = choix[1] ?? choix[0] ?? mini;
  ouvrirModale(`
    <h2 style="margin-top:0">Soutenir ${esc(a.nom_scene)}</h2>
    ${a.biographie ? `<p class="doux petit">${esc(a.biographie).slice(0, 200)}</p>` : ''}
    <label>Montant (USD)</label>
    <div class="operateurs" style="grid-template-columns:repeat(4,1fr)">
      ${choix.map((v) => `<label><input type="radio" name="mt" value="${v}" ${v === valeur ? 'checked' : ''}><span>${v} $</span></label>`).join('')}
    </div>
    <input id="mt-libre" type="number" min="${mini}" step="0.5" placeholder="Autre montant (minimum ${montant(mini)})" style="margin-top:8px">
    <div class="carte" id="partage" style="margin:14px 0 0"></div>
    <label for="mot">Un mot pour l'artiste (facultatif)</label>
    <input id="mot" maxlength="300" placeholder="Ex. Que Dieu bénisse ton ministère !">
    <label>Payer avec</label>
    <div class="operateurs">
      <label><input type="radio" name="op" value="mpesa" checked><span>M-Pesa</span></label>
      <label><input type="radio" name="op" value="orange_money"><span>Orange Money</span></label>
      <label><input type="radio" name="op" value="airtel_money"><span>Airtel Money</span></label>
    </div>
    <label for="tel-don">Numéro Mobile Money</label>
    <input id="tel-don" type="tel" inputmode="tel" value="${esc((etat.profil?.telephone || '').replace('+243', '0'))}">
    <button class="btn plein" id="envoyer-don">Envoyer</button>
    <button class="btn secondaire plein" style="margin-top:10px" data-fermer>Annuler</button>`);

  const maj = () => {
    const libre = Number($('#mt-libre').value);
    valeur = libre > 0 ? libre : Number($('input[name=mt]:checked')?.value || 0);
    const pa = Math.round(valeur * part) / 100;
    $('#partage').innerHTML = `
      <div style="display:flex;justify-content:space-between"><span>${esc(a.nom_scene)} reçoit (${part} %)</span><b style="color:var(--or)">${montant(pa)}</b></div>
      <div style="display:flex;justify-content:space-between" class="doux petit"><span>Administration Mongongo Way (${100 - part} %)</span><span>${montant(valeur - pa)}</span></div>`;
    $('#envoyer-don').textContent = `Envoyer ${montant(valeur)}`;
  };
  $$('input[name=mt]').forEach((r) => r.onchange = () => { $('#mt-libre').value = ''; maj(); });
  $('#mt-libre').oninput = () => { if ($('#mt-libre').value) $$('input[name=mt]').forEach((r) => r.checked = false); maj(); };
  maj();

  $('#envoyer-don').onclick = () => {
    if (!(valeur >= mini)) return toast(`Le soutien minimum est de ${montant(mini)}.`, true);
    if (!telValide(normaliserTel($('#tel-don').value))) return toast('Numéro Mobile Money invalide.', true);
    toast('Le paiement Mobile Money sera activé très bientôt. Merci pour votre générosité !');
    fermerModale();
  };
}

// =========================================================
// DÉMARRAGE
// =========================================================
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); window.__installation = e; });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

// ---------- Mise à jour automatique ----------
// Version de l'app en cours (lue dans l'adresse de ce fichier : app.js?v=NN)
const VERSION_APP = Number(new URL(import.meta.url).searchParams.get('v')) || 0;
let majEnAttente = false;
async function verifierMiseAJour() {
  if (!VERSION_APP || document.visibilityState !== 'visible') return;
  try {
    const html = await (await fetch('index.html?verif=' + Date.now(), { cache: 'no-store' })).text();
    const enLigne = Number((html.match(/app\.js\?v=(\d+)/) || [])[1]) || 0;
    if (enLigne > VERSION_APP) { majEnAttente = true; appliquerMiseAJour(); }
  } catch (_) { /* pas de connexion : on réessaiera */ }
}
function occupe() {
  // On n'interrompt pas : musique ou clip en cours, formulaire en train d'être rempli, fenêtre ouverte, envoi en cours
  const clip = $$('video').some((v) => !v.paused);
  const saisie = $$('textarea, input:not([type=file]):not([type=search]):not([type=radio]):not([type=checkbox])').some((x) => x.value && x.offsetParent && !x.readOnly && x.id !== 'tel-paie' && x.id !== 'tel-don');
  const envoi = $$('button[disabled]').length > 0 || !!$('.progression:not(.cache)');
  return !audio.paused || clip || saisie || envoi || !$('#modale').classList.contains('cache');
}
function appliquerMiseAJour() {
  if (!majEnAttente) return;
  if (!occupe()) { location.reload(); return; }
  // Occupé : on propose sans forcer
  if (!$('#bandeau-maj')) {
    document.body.insertAdjacentHTML('beforeend', `<div id="bandeau-maj" class="bandeau-maj">Nouvelle version disponible <button class="btn petit" id="btn-maj">Mettre à jour</button></div>`);
    $('#btn-maj').onclick = () => location.reload();
  }
}
// Vérification à chaque retour dans l'app et toutes les 10 minutes
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') verifierMiseAJour(); });
setInterval(verifierMiseAJour, 10 * 60000);
setTimeout(verifierMiseAJour, 15000);
// Une mise à jour en attente s'applique dès que l'utilisateur n'est plus occupé (fin de chanson, changement de page)
audio.addEventListener('ended', () => setTimeout(appliquerMiseAJour, 500));
window.addEventListener('hashchange', () => setTimeout(appliquerMiseAJour, 300));

let premierChargement = true;
sb.auth.onAuthStateChange((evenement, session) => {
  const changement = !!etat.session !== !!session || etat.session?.user?.id !== session?.user?.id;
  etat.session = session;
  if (premierChargement || changement) {
    premierChargement = false;
    setTimeout(async () => {
      try { await chargerProfil(); } catch (e) { console.error(e); }
      demarrerPresence();
      if (!session) {
        audio.pause();
        document.body.classList.remove('avec-lecteur');
        $('#lecteur').classList.add('cache');
      }
      router();
    }, 0);
  }
});

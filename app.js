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
  abonnement: vueAbonnement
};

async function router() {
  const [nom, param] = (location.hash.replace(/^#\//, '') || 'accueil').split('/');
  const connecte = !!etat.session;
  $('#nav').classList.toggle('cache', !connecte);
  if (!connecte && nom !== 'connexion') { location.hash = '#/connexion'; return; }
  if (connecte && nom === 'connexion') { location.hash = '#/accueil'; return; }
  $$('#nav a').forEach((a) => a.classList.toggle('actif', a.dataset.route === nom || (nom === 'deposer' && a.dataset.route === 'artiste') || (['admin', 'achats', 'abonnement'].includes(nom) && a.dataset.route === 'profil')));
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
    .select('id, titre, genre, pochette_path, audio_path, video_path, duree_sec, nb_ecoutes, prix_telechargement, prix_video, devise, publie_le, artistes(nom_scene)')
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
    <h2 style="margin-top:6px">Nouveautés</h2>
    <div id="liste" class="liste"></div>`;

  const dessinerListe = (liste) => {
    etat.file = liste;
    $('#liste').innerHTML = liste.length ? liste.map(ligneTitre).join('') : `
      <div class="vide"><span class="grand">♪</span>${titres.length ? 'Aucun résultat.' : 'Aucun titre publié pour le moment.<br>Les premiers chants arrivent bientôt !'}</div>`;
    brancherLignes($('#liste'));
  };
  dessinerListe(titres);
  $('#cherche').oninput = (e) => {
    const q = e.target.value.trim().toLowerCase();
    dessinerListe(!q ? titres : titres.filter((t) =>
      [t.titre, t.genre, t.artistes?.nom_scene].some((v) => (v || '').toLowerCase().includes(q))));
  };
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
  // 2) Écoute en ligne (lien temporaire)
  const { data, error } = await sb.storage.from('audio').createSignedUrl(t.audio_path, 60 * 60 * 3);
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
  if (!t?.audio_path) return toast('Fichier audio introuvable.', true);
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
  const cat = (await chargerCatalogue()).filter((x) => x.id !== etat.enCours?.id && x.audio_path);
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
  const boutonFormat = (f) => {
    const nom = f === 'audio' ? 'l\'audio' : 'la vidéo';
    const prix = f === 'audio' ? t.prix_telechargement : t.prix_video;
    if (!achete[f] && estAbonne()) return `<button class="btn secondaire" data-hors="${f}">${hors[f] ? `✓ ${f === 'audio' ? 'Audio' : 'Vidéo'} hors ligne` : `⤓ ${f === 'audio' ? 'Audio' : 'Vidéo'} · inclus`}</button>`;
    if (!achete[f]) return `<button class="btn secondaire" data-acheter="${f}">⤓ ${f === 'audio' ? 'Audio' : 'Vidéo'} · ${montant(prix, t.devise)}</button>`;
    return `<button class="btn secondaire" data-hors="${f}">${hors[f] ? `✓ ${f === 'audio' ? 'Audio' : 'Vidéo'} hors ligne` : `⤓ Enregistrer ${nom}`}</button>`;
  };

  const enCours = etat.enCours?.id === t.id && !audio.paused;
  vue.innerHTML = `
    <div class="detail-tete">
      ${t.video_path ? `<div class="clip"><video id="clip" controls playsinline preload="none" ${t.pochette_path ? `poster="${esc(urlPochette(t.pochette_path))}"` : ''}></video><button class="clip-lancer" id="clip-lancer">▶ Regarder le clip</button></div>` : imgPochette(t.pochette_path)}
      <h1>${esc(t.titre)}</h1>
      <div class="doux"><a href="#/a/${t.artistes?.id}">${esc(t.artistes?.nom_scene || '')}</a>${t.album ? ' · ' + esc(t.album) : ''}${t.genre ? ' · ' + esc(t.genre) : ''}</div>
      ${t.statut !== 'publie' ? `<div style="margin-top:8px"><span class="badge ${t.statut}">${STATUTS_TITRE[t.statut]}</span></div>` : ''}
      <div class="actions">
        <button class="btn" id="btn-ecouter" data-id="${t.id}">${enCours ? '❚❚ Pause' : '▶ Écouter'}</button>
        <button class="btn secondaire" id="btn-like">${monLike ? '<span class="aime">♥</span>' : '♡'} <span id="nb-likes">${nbLikes || 0}</span></button>
      </div>
      ${t.statut === 'publie' ? `<div class="actions" style="margin-top:0">${boutonFormat('audio')}${t.video_path ? boutonFormat('video') : ''}</div>` : ''}
      <div class="stats"><span>${(t.nb_ecoutes || 0).toLocaleString('fr-FR')} écoutes</span>${t.duree_sec ? `<span>${duree(t.duree_sec)}</span>` : ''}${t.publie_le ? `<span>${dateCourte(t.publie_le)}</span>` : ''}</div>
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

  vue.querySelectorAll('[data-acheter]').forEach((b) => b.onclick = () => modalePaiement(t, 'telechargement', b.dataset.acheter));
  vue.querySelectorAll('[data-hors]').forEach((b) => b.onclick = async () => {
    const f = b.dataset.hors;
    if (hors[f]) return toast(f === 'audio' ? 'L\'audio est déjà enregistré sur ce téléphone.' : 'La vidéo est déjà enregistrée sur ce téléphone.');
    b.disabled = true; b.textContent = 'Enregistrement…';
    try {
      const { data, error } = await sb.storage.from(f === 'audio' ? 'audio' : 'videos').download(f === 'audio' ? t.audio_path : t.video_path);
      if (error) throw error;
      const cache = await caches.open(CACHE_HORS_LIGNE);
      await cache.put(cleHL[f], new Response(data, { headers: { 'Content-Type': data.type || (f === 'audio' ? 'audio/mpeg' : 'video/mp4') } }));
      hors[f] = true; b.textContent = `✓ ${f === 'audio' ? 'Audio' : 'Vidéo'} hors ligne`;
      toast(f === 'audio' ? 'Audio enregistré : écoutez-le sans internet.' : 'Vidéo enregistrée : regardez-la sans internet.');
    } catch (err) { erreur(err); b.textContent = f === 'audio' ? '⤓ Enregistrer l\'audio' : '⤓ Enregistrer la vidéo'; }
    b.disabled = false;
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
      <span class="auteur">${esc(c.profils?.nom_complet || 'Membre')}</span><span class="date">${dateCourte(c.cree_le)}</span>
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
      await sb.storage.from('audio').remove([t.audio_path]);
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
        ${t.statut === 'publie' ? `<p class="doux petit" style="margin:6px 0 0">${t.nb_ecoutes} écoutes · ${t.nb_telechargements} téléchargements</p>` : ''}
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

      <label for="d-video">Vidéo du chant (MP4, 50 Mo max.)</label>
      <input id="d-video" type="file" accept="video/mp4,video/webm,video/quicktime,video/3gpp,.mp4,.mov,.webm,.3gp">
      <p class="doux petit" style="margin:6px 0 0">L'audio est tiré automatiquement de la vidéo. Pas de vidéo ? Déposez seulement le fichier audio ci-dessous.</p>
      <div id="bloc-compression" class="carte cache" style="margin:10px 0 0"></div>

      <label for="d-audio">Fichier audio (MP3 ou M4A, 30 Mo max.) — seulement sans vidéo</label>
      <input id="d-audio" type="file" accept="audio/mpeg,audio/mp3,audio/mp4,audio/x-m4a,audio/aac,.mp3,.m4a,.aac">

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
        <span><b>Compresser en ${grand > 1280 || infoVid.largeur > 1280 ? '720p' : 'qualité allégée'}</b>${conseil ? ' (recommandé)' : ''}<br><span class="doux petit">Environ ${estime} Mo · plus rapide à envoyer et à regarder</span></span>
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

  $('#form-depot').onsubmit = async (e) => {
    e.preventDefault();
    let fVid = $('#d-video').files[0];
    let fAudio = $('#d-audio').files[0];
    const fImg = $('#d-pochette').files[0];
    if (!fVid && !fAudio) return toast('Choisissez la vidéo du chant, ou un fichier audio.', true);
    const compresser = !!fVid && $('input[name=compr]:checked')?.value !== 'non';
    if (fVid && !compresser && fVid.size > 50 * 1024 * 1024) return toast('Vidéo trop lourde (50 Mo max.) : choisissez « Compresser ».', true);
    if (fAudio && fAudio.size > 30 * 1024 * 1024) return toast('Fichier audio trop lourd (30 Mo max.).', true);
    if (fImg && fImg.size > 5 * 1024 * 1024) return toast('Image trop lourde (5 Mo max.).', true);

    const bouton = e.submitter; bouton.disabled = true;
    const prog = $('#prog'); prog.classList.remove('cache');
    const avancer = (p, msg) => { prog.firstElementChild.style.width = p + '%'; bouton.textContent = msg; };
    const uid = etat.session.user.id;
    const horo = Date.now();
    try {
      let dureeSec = null;
      let typeA = 'audio/mpeg', extA = 'mp3';
      if (compresser) {
        const avant = fVid.size;
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
      if (fVid) {
        // L'audio est une copie de la vidéo : extraction en MP3 sur le téléphone
        avancer(30, 'Extraction de l\'audio…');
        try {
          const r = await extraireAudio(fVid, (x) => avancer(30 + Math.round(x * 12), `Extraction de l'audio… ${Math.round(x * 100)} %`));
          fAudio = r.fichier; dureeSec = r.duree;
        } catch (err) {
          console.error(err);
          throw new Error('Impossible de tirer l\'audio de cette vidéo sur ce téléphone. Réessayez sur un autre appareil, ou ajoutez aussi le fichier audio.');
        }
      } else {
        avancer(10, 'Lecture du fichier…');
        dureeSec = await lireDuree(fAudio);
        extA = (fAudio.name.split('.').pop() || 'mp3').toLowerCase();
        typeA = { mp3: 'audio/mpeg', m4a: 'audio/x-m4a', aac: 'audio/aac', mp4: 'audio/mp4' }[extA] || fAudio.type || 'audio/mpeg';
      }

      avancer(44, 'Envoi de l\'audio…');
      const cheminAudio = `${uid}/${horo}.${extA}`;
      const upA = await sb.storage.from('audio').upload(cheminAudio, fAudio, { contentType: typeA });
      if (upA.error) throw upA.error;

      let cheminVid = null;
      if (fVid) {
        avancer(55, 'Envoi de la vidéo… (patientez)');
        const extV = fVid.type === 'video/webm' ? 'webm' : fVid.type === 'video/mp4' && !fVid.name ? 'mp4' : (fVid.name.split('.').pop() || 'mp4').toLowerCase();
        const typeV = { mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', '3gp': 'video/3gpp' }[extV] || fVid.type || 'video/mp4';
        cheminVid = `${uid}/${horo}.${extV}`;
        const upV = await sb.storage.from('videos').upload(cheminVid, fVid, { contentType: typeV });
        if (upV.error) throw upV.error;
      }

      let cheminImg = null;
      if (fImg) {
        avancer(85, 'Envoi de la pochette…');
        const extI = (fImg.name.split('.').pop() || 'jpg').toLowerCase();
        cheminImg = `${uid}/${horo}.${extI}`;
        const upI = await sb.storage.from('pochettes').upload(cheminImg, fImg, { contentType: fImg.type });
        if (upI.error) throw upI.error;
      }

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
        audio_path: cheminAudio,
        video_path: cheminVid,
        pochette_path: cheminImg,
        duree_sec: dureeSec || null,
        prix_telechargement: Number($('#d-prix').value),
        prix_video: fVid ? Number($('#d-prix-video').value || prixVideoDefaut) : prixVideoDefaut,
        devise: 'USD'
      });
      if (error) throw error;
      avancer(100, 'Terminé ✓');
      toast('Titre enregistré. Envoyez-le maintenant pour validation.');
      location.hash = '#/artiste';
    } catch (err) {
      erreur(err);
      bouton.disabled = false; bouton.textContent = 'Enregistrer le titre';
      prog.classList.add('cache');
    }
  };
}

// ---------- Compression vidéo sur le téléphone ----------
function lireInfosVideo(fichier) {
  return new Promise((ok) => {
    const v = document.createElement('video');
    const u = URL.createObjectURL(fichier);
    v.preload = 'metadata'; v.muted = true;
    const fin = (r) => { URL.revokeObjectURL(u); ok(r); };
    v.onloadedmetadata = () => fin({ largeur: v.videoWidth || 0, hauteur: v.videoHeight || 0, duree: isFinite(v.duration) ? v.duration : 0 });
    v.onerror = () => fin({ largeur: 0, hauteur: 0, duree: 0 });
    v.src = u;
    setTimeout(() => fin({ largeur: 0, hauteur: 0, duree: 0 }), 8000);
  });
}
// Débit visé : environ 28 Mo pour le clip, entre 450 kb/s et 2 Mb/s pour l'image
function debitVideo(dureeSec) {
  const d = Math.max(30, dureeSec || 240);
  return Math.round(Math.min(2_000_000, Math.max(450_000, (28 * 8 * 1e6) / d - 128_000)));
}
function estimerTaille(dureeSec) {
  const d = Math.max(30, dureeSec || 240);
  return Math.max(3, Math.round(((debitVideo(d) + 128_000) * d) / 8 / 1048576));
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
      <a href="#/achats">Mes téléchargements</a>
      <a href="#/artiste">${etat.artiste ? 'Mon espace artiste' : 'Devenir artiste'}</a>
      ${estAdmin() ? '<a href="#/admin">Administration</a>' : ''}
      <button id="modif-nom">Modifier mon nom</button>
      <button id="installer" class="cache">Installer l'application sur ce téléphone</button>
      <button id="deconnexion" style="color:var(--rouge)">Se déconnecter</button>
    </div>
    <div class="apropos">
      <img src="icon-192.png" width="40" height="40" alt="" style="border-radius:10px"><br>
      <b style="color:var(--texte)">Mongongo Way</b> · version 1.0<br>
      La plateforme musicale des musiciens de Theway RDC<br>
      Conçue et développée par <b style="color:var(--texte)">Ingénieur Van MUFWAR</b>
    </div>`;

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
  const [{ data: artistes }, { data: titres }, { data: tarifs }, { count: nbMembres }, { count: nbPublies }] = await Promise.all([
    sb.from('artistes').select('*, profils(nom_complet, telephone)').eq('statut', 'en_attente').order('cree_le'),
    sb.from('titres').select('*, artistes(nom_scene)').in('statut', ['en_attente_paiement', 'en_validation']).order('cree_le'),
    sb.from('tarifs').select('*').order('cle'),
    sb.from('profils').select('*', { count: 'exact', head: true }),
    sb.from('titres').select('*', { count: 'exact', head: true }).eq('statut', 'publie')
  ]);

  vue.innerHTML = `
    <h1>Administration</h1>
    <div class="chiffres">
      <div class="chiffre"><b>${nbMembres ?? 0}</b><span>membres</span></div>
      <div class="chiffre"><b>${nbPublies ?? 0}</b><span>titres publiés</span></div>
      <div class="chiffre"><b>${(artistes?.length || 0) + (titres?.length || 0)}</b><span>à valider</span></div>
    </div>
    <div class="onglets" style="margin-top:0">
      <button data-o="artistes" class="${onglet === 'artistes' ? 'actif' : ''}">Artistes (${artistes?.length || 0})</button>
      <button data-o="titres" class="${onglet === 'titres' ? 'actif' : ''}">Titres (${titres?.length || 0})</button>
      <button data-o="membres" class="${onglet === 'membres' ? 'actif' : ''}">Membres</button>
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
        ouvrirModale(`<h2 style="margin-top:0">${esc(tc.titre)}</h2><video src="${esc(u.signedUrl)}" controls autoplay playsinline style="width:100%;border-radius:12px;background:#000"></video><button class="btn secondaire plein" data-fermer>Fermer</button>`);
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
    zone.innerHTML = `
      <p class="doux petit" style="margin-top:0">${liste.length} membre${liste.length > 1 ? 's' : ''} (vous exclu), du plus récent au plus ancien.</p>
      <div class="recherche"><input id="cherche-membre" type="search" placeholder="Rechercher un nom ou un numéro…"></div>
      <div id="liste-membres"></div>`;
    const dessiner = (l) => {
      $('#liste-membres').innerHTML = l.length ? l.map((m) => `
        <div class="carte" style="display:flex;gap:12px;align-items:center;padding:12px 14px">
          <div class="avatar petit-avatar">${esc((m.nom_complet || '?').charAt(0).toUpperCase())}</div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:600">${esc(m.nom_complet || 'Sans nom')} ${recent(m.inscrit_le) ? '<span class="badge en_attente">Nouveau</span>' : ''}</div>
            <div class="doux petit">${esc(m.telephone || '')} · ${roles[m.role] || m.role}${m.nom_artiste ? ' (' + esc(m.nom_artiste) + ')' : ''}</div>
            <div class="doux petit">Inscrit le ${dateCourte(m.inscrit_le)} · dernière connexion ${quand(m.derniere_connexion)}</div>
            <div class="petit" style="margin-top:4px">${m.abonne_jusqu_au ? `<span class="badge valide">Abonné jusqu'au ${dateCourte(m.abonne_jusqu_au)}</span>` : '<span class="badge">Non abonné</span>'}
              <button class="lien-bouton petit" data-abonner="${m.id}" style="margin-left:8px">${m.abonne_jusqu_au ? 'Prolonger' : 'Activer un abonnement'}</button></div>
          </div>
        </div>`).join('') : '<div class="vide">Aucun membre pour le moment.</div>';
    };
    dessiner(liste);
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
      ${a.profil_id !== etat.session.user.id ? '<button class="btn secondaire" data-soutenir>♥ Soutenir</button>' : ''}
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
      <video id="clip-plein" src="${esc(src)}" controls autoplay playsinline style="width:100%;border-radius:12px;background:#000"></video>
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

let premierChargement = true;
sb.auth.onAuthStateChange((evenement, session) => {
  const changement = !!etat.session !== !!session || etat.session?.user?.id !== session?.user?.id;
  etat.session = session;
  if (premierChargement || changement) {
    premierChargement = false;
    setTimeout(async () => {
      try { await chargerProfil(); } catch (e) { console.error(e); }
      if (!session) {
        audio.pause();
        document.body.classList.remove('avec-lecteur');
        $('#lecteur').classList.add('cache');
      }
      router();
    }, 0);
  }
});

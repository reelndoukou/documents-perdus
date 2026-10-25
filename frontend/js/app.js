// app.js : interface de Documents Perdus

const API = '/api';
const CLE_ACCES = 'dp_acces';

const etat = {
  prix: { commission_deblocage: 2000, prix_alerte: 1000, indemnite_conseillee_min: 1000, delai_reessai_heures: 48 },
  declarationChoisie: null,
  derniereRecherche: null,
};

// ============ UTILITAIRES ============

// Échappe le HTML : protège contre l'injection de code via les champs saisis
function echapper(t) {
  return String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fcfa(n) {
  return `${Number(n).toLocaleString('fr-FR')} FCFA`;
}

function toast(message, type = 'succes') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

// Appel générique à l'API : JSON ou FormData
async function appel(chemin, options = {}) {
  const headers = {};
  if (typeof options.body === 'string') headers['Content-Type'] = 'application/json';
  const reponse = await fetch(API + chemin, { ...options, headers });
  let donnees = null;
  try { donnees = await reponse.json(); } catch { /* réponse sans JSON */ }
  if (!reponse.ok) throw new Error((donnees && donnees.erreur) || `Erreur ${reponse.status}`);
  return donnees;
}

const post = (chemin, objet) => appel(chemin, { method: 'POST', body: JSON.stringify(objet) });

// Réduit une photo (1280 px max, JPEG qualité 0.8) pour rester sous la limite de 5 Mo
function compresserImage(fichier, maxDim = 1280, qualite = 0.8) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(fichier);
    img.onload = () => {
      const ratio = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * ratio);
      canvas.height = Math.round(img.height * ratio);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        URL.revokeObjectURL(url);
        blob ? resolve(new File([blob], 'photo.jpg', { type: 'image/jpeg' })) : reject(new Error('Compression impossible'));
      }, 'image/jpeg', qualite);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image illisible (utilisez un fichier JPG ou PNG)')); };
    img.src = url;
  });
}

// Codes d'accès mémorisés sur l'appareil
function lireAcces() {
  try { return JSON.parse(localStorage.getItem(CLE_ACCES)) || []; } catch { return []; }
}
function ajouterAcces(token, nom) {
  try {
    const liste = lireAcces().filter((a) => a.token !== token);
    liste.unshift({ token, nom, date: new Date().toISOString() });
    localStorage.setItem(CLE_ACCES, JSON.stringify(liste.slice(0, 20)));
  } catch { /* stockage indisponible : le code reste affiché à l'écran */ }
}

// ============ NAVIGATION ============

function afficherPage(nom) {
  document.querySelectorAll('.page').forEach((p) => p.classList.remove('visible'));
  document.getElementById(`page-${nom}`).classList.add('visible');
  document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('actif', a.dataset.page === nom));
  if (nom === 'acces') afficherListeAcces();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.addEventListener('click', (e) => {
  const cible = e.target.closest('[data-page]');
  if (cible) { e.preventDefault(); afficherPage(cible.dataset.page); }
});

// ============ DÉCLARATION D'UN DOCUMENT TROUVÉ ============

const formDecl = document.getElementById('form-declaration');

function majFormDeclaration() {
  const mode = formDecl.querySelector('input[name="mode"]:checked').value;
  const depose = mode === 'depose';
  const anonyme = depose && document.getElementById('decl-anonyme').checked;

  document.getElementById('bloc-depose').style.display = depose ? 'block' : 'none';
  if (!depose) document.getElementById('decl-anonyme').checked = false;
  document.getElementById('bloc-coordonnees').style.display = anonyme ? 'none' : 'block';
  document.getElementById('decl-lieu').required = depose;
  document.getElementById('decl-dnom').required = !depose;
  document.getElementById('decl-dtel').required = !depose;
}

formDecl.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener('change', majFormDeclaration));
document.getElementById('decl-anonyme').addEventListener('change', majFormDeclaration);

formDecl.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('btn-declarer');
  const mode = formDecl.querySelector('input[name="mode"]:checked').value;
  const anonyme = mode === 'depose' && document.getElementById('decl-anonyme').checked;
  const v = (id) => document.getElementById(id).value.trim();

  try {
    if (!v('decl-nom') || !v('decl-ville')) throw new Error('Le nom figurant sur le document et la ville sont obligatoires');
    const f1 = document.getElementById('photo1').files[0];
    const f2 = document.getElementById('photo2').files[0];
    if (!f1 || !f2) throw new Error('Ajoutez les deux photos du document');
    if (mode === 'depose' && !v('decl-lieu')) throw new Error("Décrivez l'endroit où le document a été déposé");
    if (mode === 'garde' && (!v('decl-dnom') || !v('decl-dtel'))) throw new Error('Votre nom et votre téléphone sont obligatoires');

    btn.disabled = true;
    btn.textContent = 'Envoi en cours...';

    const [p1, p2] = await Promise.all([compresserImage(f1), compresserImage(f2)]);

    const fd = new FormData();
    fd.append('type_document_id', v('decl-type'));
    fd.append('nom_complet', v('decl-nom'));
    fd.append('ville', v('decl-ville'));
    fd.append('mode', mode);
    fd.append('anonyme', anonyme ? 'true' : 'false');
    if (mode === 'depose') fd.append('lieu_depot_description', v('decl-lieu'));
    if (!anonyme) {
      fd.append('declarant_nom', v('decl-dnom'));
      fd.append('declarant_telephone', v('decl-dtel'));
      fd.append('declarant_email', v('decl-dmail'));
      fd.append('declarant_ville', v('decl-dville'));
      fd.append('declarant_quartier', v('decl-dquartier'));
    }
    fd.append('images', p1);
    fd.append('images', p2);

    const res = await appel('/declarations', { method: 'POST', body: fd });
    toast(res.message);
    formDecl.reset();
    majFormDeclaration();
    afficherPage('accueil');
  } catch (err) {
    toast(err.message, 'erreur');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Déclarer le document';
  }
});

// ============ RECHERCHE D'UN DOCUMENT PERDU ============

const zoneResultats = document.getElementById('resultats');

document.getElementById('form-recherche').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nom = document.getElementById('rech-nom').value.trim();
  const type = document.getElementById('rech-type').value;
  const ville = document.getElementById('rech-ville').value.trim();

  if (!nom || !ville) return toast('Le nom complet et la ville sont obligatoires', 'erreur');

  try {
    const q = new URLSearchParams({ nom, type_document_id: type, ville }).toString();
    const res = await appel(`/declarations/recherche?${q}`);
    etat.derniereRecherche = { nom, type, ville };

    if (res.trouve) afficherResultats(res.resultats);
    else afficherNonTrouve(res);
  } catch (err) {
    toast(err.message, 'erreur');
  }
});

function afficherResultats(liste) {
  zoneResultats.innerHTML =
    `<div class="message ok">Un document correspondant à votre recherche a été déclaré. Vérifiez sur les photos que c'est bien le vôtre.</div>` +
    liste.map((r) => `
      <div class="carte resultat">
        <div class="photos">
          ${r.images.map((u) => `<div class="img-wrap"><img src="${echapper(u)}" alt="Photo du document"></div>`).join('')}
        </div>
        <div class="infos">
          <span class="badge">${echapper(r.type_document)}</span>
          <h3>${echapper(r.nom_complet)}</h3>
          <p>Ville : <strong>${echapper(r.ville)}</strong><br>Déclaré le ${new Date(r.date_creation).toLocaleDateString('fr-FR')}</p>
          <p>${r.mode === 'garde'
            ? 'La personne qui a trouvé ce document le garde sur elle.'
            : 'Ce document a été déposé dans un établissement public.'}</p>
          <button data-action="payer" data-id="${r.id}" data-nom="${echapper(r.nom_complet)}">C'est mon document : contacter</button>
        </div>
      </div>`).join('');
}

function afficherNonTrouve(res) {
  const r = etat.derniereRecherche;
  zoneResultats.innerHTML = `
    <div class="message info">${echapper(res.message)}</div>
    <form id="form-alerte" class="carte" novalidate>
      <h2>Être prévenu dès que votre document est retrouvé</h2>
      <p class="aide">Notre équipe vous prévient par e-mail et par appel. Prix : <strong>${fcfa(res.alerte.prix)}</strong>, payable via Mobile Money.</p>
      <div class="bandeau-simulation">Mode simulation : aucun argent réel n'est prélevé.</div>
      <div class="grille">
        <div><label>Nom sur le document</label><input type="text" id="al-nom" value="${echapper(r.nom)}" required></div>
        <div><label>Votre téléphone *</label><input type="tel" id="al-tel" placeholder="06 000 00 00" required></div>
        <div><label>Votre e-mail</label><input type="email" id="al-mail"></div>
      </div>
      <button type="submit" id="btn-alerte">Activer l'alerte (${fcfa(res.alerte.prix)})</button>
    </form>`;

  document.getElementById('form-alerte').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-alerte');
    btn.disabled = true;
    try {
      const rep = await post('/alertes', {
        nom_complet: document.getElementById('al-nom').value,
        type_document_id: r.type,
        ville: r.ville,
        telephone: document.getElementById('al-tel').value,
        email: document.getElementById('al-mail').value,
      });
      zoneResultats.innerHTML = `<div class="message ok">${echapper(rep.message)}</div>`;
      toast('Alerte activée');
    } catch (err) {
      toast(err.message, 'erreur');
      btn.disabled = false;
    }
  });
}

// Boutons des résultats (délégation d'événements)
zoneResultats.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  if (btn.dataset.action === 'payer') ouvrirPaiement(btn.dataset.id, btn.dataset.nom);
  if (btn.dataset.action === 'restitue') confirmerRestitution(btn.dataset.token, zoneResultats);
  if (btn.dataset.action === 'signaler') signalerProbleme(btn.dataset.token, zoneResultats);
});

// ============ PAIEMENT (SIMULÉ) ============

const modal = document.getElementById('modal-paiement');

function ouvrirPaiement(id, nom) {
  etat.declarationChoisie = id;
  document.getElementById('paiement-resume').innerHTML =
    `Vous allez débloquer les informations pour récupérer le document de <strong>${echapper(nom)}</strong>. ` +
    `Commission de la plateforme : <strong>${fcfa(etat.prix.commission_deblocage)}</strong>.`;
  document.getElementById('pay-indemnite').textContent = fcfa(etat.prix.indemnite_conseillee_min);
  modal.classList.add('ouvert');
}

function fermerPaiement() { modal.classList.remove('ouvert'); }
document.getElementById('modal-fermer').addEventListener('click', fermerPaiement);
modal.addEventListener('click', (e) => { if (e.target === modal) fermerPaiement(); });

document.getElementById('form-paiement').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('btn-payer');
  btn.disabled = true;
  btn.textContent = 'Paiement en cours...';
  try {
    const nom = document.getElementById('pay-nom').value;
    const rep = await post(`/declarations/${etat.declarationChoisie}/debloquer`, {
      proprietaire_nom: nom,
      proprietaire_telephone: document.getElementById('pay-tel').value,
    });
    ajouterAcces(rep.token, nom);
    fermerPaiement();
    e.target.reset();
    zoneResultats.innerHTML = htmlReveal({ ...rep, statut: 'debloque' }, rep.token, true);
    toast('Paiement reçu');
    zoneResultats.scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    toast(err.message, 'erreur');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Payer';
  }
});

// ============ INFORMATIONS DÉBLOQUÉES ============

function htmlReveal(d, token, nouveau = false) {
  const c = d.contact;
  let html = '<div class="carte reveal">';
  html += nouveau
    ? '<div class="message ok"><strong>Paiement reçu.</strong> Voici comment récupérer votre document.</div>'
    : '<h2>Informations pour récupérer votre document</h2>';

  if (d.document) html += `<p><strong>${echapper(d.document.type_document)}</strong> au nom de <strong>${echapper(d.document.nom_complet)}</strong> (${echapper(d.document.ville)})</p><br>`;

  if (c) {
    html += '<div class="bloc"><h4>Coordonnées de la personne qui a trouvé le document</h4><ul>';
    if (c.nom) html += `<li>Nom : <strong>${echapper(c.nom)}</strong></li>`;
    if (c.telephone) html += `<li>Téléphone : <a href="tel:${echapper(c.telephone)}">${echapper(c.telephone)}</a></li>`;
    if (c.email) html += `<li>E-mail : <a href="mailto:${echapper(c.email)}">${echapper(c.email)}</a></li>`;
    if (c.ville) html += `<li>Ville : ${echapper(c.ville)}</li>`;
    if (c.quartier) html += `<li>Quartier : ${echapper(c.quartier)}</li>`;
    html += '</ul></div>';
  }
  if (d.lieu_depot) {
    html += `<div class="bloc"><h4>Où se trouve le document</h4><p>${echapper(d.lieu_depot)}</p></div>`;
  }

  html += `<div class="bloc danger"><h4>Pour votre sécurité</h4><p>${echapper(d.avertissement)}</p>
           <p><strong>Indemnité de déplacement :</strong> au moins ${fcfa(etat.prix.indemnite_conseillee_min)}, à remettre en main propre après avoir vérifié et récupéré votre document.</p></div>`;

  html += `<p class="aide">Conservez ce code pour retrouver ces informations plus tard (onglet « Mes accès ») :<br><span class="code-acces">${echapper(token)}</span></p>`;

  if (d.statut === 'restitue') {
    html += '<div class="message ok">Document restitué. Merci d\'avoir utilisé Documents Perdus !</div>';
  } else if (d.statut === 'signale') {
    html += '<div class="message info">Votre signalement est en cours d\'examen par notre équipe.</div>';
  } else {
    html += `<div class="actions">
      <button data-action="restitue" data-token="${echapper(token)}">J'ai récupéré mon document</button>
      <button class="danger" data-action="signaler" data-token="${echapper(token)}">Signaler un problème</button>
    </div>`;
  }
  return html + '</div>';
}

async function confirmerRestitution(token, zone) {
  if (!confirm('Confirmez-vous avoir récupéré votre document ?')) return;
  try {
    await appel(`/deblocages/${token}/restitue`, { method: 'PUT' });
    toast('Merci ! Document marqué comme restitué');
    await consulterAcces(token, zone);
  } catch (err) { toast(err.message, 'erreur'); }
}

async function signalerProbleme(token, zone) {
  if (!confirm('Signaler que ce document ne correspond pas, ou que la déclaration est frauduleuse ?')) return;
  try {
    await appel(`/deblocages/${token}/signaler`, { method: 'PUT' });
    toast('Signalement envoyé à notre équipe', 'info');
    await consulterAcces(token, zone);
  } catch (err) { toast(err.message, 'erreur'); }
}

// ============ MES ACCÈS ============

const zoneAcces = document.getElementById('zone-acces');

async function consulterAcces(token, zone = zoneAcces) {
  try {
    const d = await appel(`/deblocages/${encodeURIComponent(token.trim())}`);
    zone.innerHTML = htmlReveal(d, token.trim());
  } catch (err) {
    zone.innerHTML = `<div class="message erreur">${echapper(err.message)}</div>`;
  }
}

function afficherListeAcces() {
  const liste = lireAcces();
  document.getElementById('liste-acces').innerHTML = liste.length
    ? liste.map((a) => `
        <div class="liste-item">
          <div><strong>${echapper(a.nom)}</strong><br><small>${new Date(a.date).toLocaleDateString('fr-FR')}</small></div>
          <button class="petit" data-token="${echapper(a.token)}">Consulter</button>
        </div>`).join('')
    : '<p class="vide">Aucun accès enregistré sur cet appareil.</p>';
}

document.getElementById('liste-acces').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-token]');
  if (btn) consulterAcces(btn.dataset.token);
});

document.getElementById('form-acces').addEventListener('submit', (e) => {
  e.preventDefault();
  const token = document.getElementById('acces-token').value.trim();
  if (!token) return toast('Collez votre code d\'accès', 'erreur');
  consulterAcces(token);
});

zoneAcces.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  if (btn.dataset.action === 'restitue') confirmerRestitution(btn.dataset.token, zoneAcces);
  if (btn.dataset.action === 'signaler') signalerProbleme(btn.dataset.token, zoneAcces);
});

// ============ DÉMARRAGE ============

async function init() {
  try {
    const [types, params] = await Promise.all([appel('/types-document'), appel('/parametres')]);
    Object.assign(etat.prix, params);
    const options = types.map((t) => `<option value="${t.id}">${echapper(t.libelle)}</option>`).join('');
    document.getElementById('decl-type').innerHTML = options;
    document.getElementById('rech-type').innerHTML = options;
  } catch (err) {
    toast('Impossible de charger les données : ' + err.message, 'erreur');
  }
  majFormDeclaration();
}

init();
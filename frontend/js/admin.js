// admin.js : espace équipe de Documents Perdus

const API = '/api/admin';
const CLE = 'dp_admin_token';
const CLE_EMAIL = 'dp_admin_email';

let token = null;
let emailAdmin = '';
try { token = sessionStorage.getItem(CLE); emailAdmin = sessionStorage.getItem(CLE_EMAIL) || ''; } catch { /* stockage indisponible */ }

const etatDecl = { page: 1 };
const etatPay = { page: 1 };

// ============ UTILITAIRES ============

const $ = (id) => document.getElementById(id);

function echapper(t) {
  return String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const fcfa = (n) => `${Number(n || 0).toLocaleString('fr-FR')} FCFA`;
const dateFr = (d) => new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
const vide = (v) => (v ? echapper(v) : '<span class="vide">—</span>');

const LIBELLES = {
  en_attente: 'En attente', publie: 'Publiée', restitue: 'Restituée', rejete: 'Rejetée',
  debloque: 'Débloqué', signale: 'Signalé', active: 'À traiter', notifiee: 'Prévenue',
  reussi: 'Réussi', echoue: 'Échoué',
};
const tag = (s) => `<span class="st st-${echapper(s)}">${echapper(LIBELLES[s] || s)}</span>`;

function toast(message, type = 'succes') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

// Appel API authentifié : renvoie au login si la session est expirée
async function api(chemin, options = {}) {
  const headers = { Authorization: `Bearer ${token}` };
  if (options.body) headers['Content-Type'] = 'application/json';
  const r = await fetch(API + chemin, { ...options, headers });
  let d = null;
  try { d = await r.json(); } catch { /* pas de JSON */ }
  if (r.status === 401) { deconnecter(); throw new Error((d && d.erreur) || 'Session expirée'); }
  if (!r.ok) throw new Error((d && d.erreur) || `Erreur ${r.status}`);
  return d;
}

function htmlPagination(p, action) {
  return `<button class="petit neutre" data-action="${action}" data-page="${p.page - 1}" ${p.page <= 1 ? 'disabled' : ''}>Précédent</button>
    <span>Page ${p.page} / ${p.totalPages} (${p.total} résultat(s))</span>
    <button class="petit neutre" data-action="${action}" data-page="${p.page + 1}" ${p.page >= p.totalPages ? 'disabled' : ''}>Suivant</button>`;
}

// ============ CONNEXION / DÉCONNEXION ============

$('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('btn-login');
  btn.disabled = true;
  try {
    const r = await fetch(API + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: $('log-email').value, mot_de_passe: $('log-mdp').value }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.erreur || `Erreur ${r.status}`);

    token = d.token;
    emailAdmin = d.email;
    try { sessionStorage.setItem(CLE, token); sessionStorage.setItem(CLE_EMAIL, emailAdmin); } catch { /* ignoré */ }
    $('form-login').reset();
    afficherAdmin();
  } catch (err) {
    toast(err.message, 'erreur');
  } finally {
    btn.disabled = false;
  }
});

function deconnecter() {
  token = null;
  try { sessionStorage.removeItem(CLE); sessionStorage.removeItem(CLE_EMAIL); } catch { /* ignoré */ }
  $('vue-admin').style.display = 'none';
  $('vue-login').style.display = 'flex';
}
$('btn-logout').addEventListener('click', deconnecter);

function afficherAdmin() {
  $('vue-login').style.display = 'none';
  $('vue-admin').style.display = 'block';
  $('admin-email').textContent = emailAdmin;
  afficherOnglet('dashboard');
}

// ============ ONGLETS ============

const CHARGEURS = {
  dashboard: () => chargerDashboard(),
  declarations: () => chargerDeclarations(1),
  signalements: () => chargerSignalements(),
  alertes: () => chargerAlertes(),
  paiements: () => chargerPaiements(1),
};

function afficherOnglet(nom) {
  document.querySelectorAll('.onglet').forEach((o) => o.classList.remove('visible'));
  $(`onglet-${nom}`).classList.add('visible');
  document.querySelectorAll('#nav-admin a').forEach((a) => a.classList.toggle('actif', a.dataset.onglet === nom));
  CHARGEURS[nom]().catch((err) => toast(err.message, 'erreur'));
}

$('nav-admin').addEventListener('click', (e) => {
  const a = e.target.closest('[data-onglet]');
  if (a) { e.preventDefault(); afficherOnglet(a.dataset.onglet); }
});

function majPastilles(s) {
  const p1 = $('pastille-sign');
  const p2 = $('pastille-alertes');
  p1.textContent = s.signalements_a_traiter;
  p1.style.display = s.signalements_a_traiter > 0 ? 'inline' : 'none';
  p2.textContent = s.alertes_a_traiter;
  p2.style.display = s.alertes_a_traiter > 0 ? 'inline' : 'none';
}

async function rafraichirPastilles() {
  try { majPastilles(await api('/stats')); } catch { /* ignoré */ }
}

// ============ TABLEAU DE BORD ============

async function chargerDashboard() {
  const s = await api('/stats');
  majPastilles(s);

  const t = s.paiements;
  const parType = Object.fromEntries(s.par_type.map((x) => [x.type, x]));
  const deb = parType.deblocage || { nb: 0, total: 0 };
  const alr = parType.alerte || { nb: 0, total: 0 };
  const decl = Object.fromEntries(s.declarations.map((x) => [x.statut, x.nb]));
  const totalDecl = Object.values(decl).reduce((a, b) => a + b, 0);
  const taux = totalDecl ? Math.round(((decl.restitue || 0) / totalDecl) * 100) : 0;

  const max = Math.max(1, ...s.par_jour.map((j) => j.total));
  const barres = s.par_jour.map((j) =>
    `<div class="barre ${j.total === 0 ? 'zero' : ''}" style="height:${Math.max(2, Math.round((j.total / max) * 100))}%" title="${echapper(j.jour)} : ${fcfa(j.total)}"></div>`
  ).join('');

  const lignesMois = s.par_mois.length
    ? s.par_mois.map((m) => `<tr><td>${echapper(m.mois)}</td><td class="droite">${m.nb}</td><td class="droite"><strong>${fcfa(m.total)}</strong></td></tr>`).join('')
    : '<tr><td colspan="3" class="vide">Aucun paiement</td></tr>';

  $('dash-contenu').innerHTML = `
    ${t.simule > 0 ? `<div class="message info">Une partie des revenus (${fcfa(t.simule)}) vient de <strong>paiements simulés</strong> : ce n'est pas de l'argent réel.</div>` : ''}

    <h2>Revenus</h2>
    <div class="stats-grille">
      <div class="stat"><div class="val">${fcfa(t.total)}</div><div class="lib">Revenus totaux</div><small>${t.nb} paiement(s) réussi(s)</small></div>
      <div class="stat"><div class="val">${fcfa(t.reel)}</div><div class="lib">Revenus réels</div><small>Encaissés via MonetBil</small></div>
      <div class="stat gris"><div class="val">${fcfa(t.simule)}</div><div class="lib">Revenus simulés</div><small>Tests, sans argent réel</small></div>
      <div class="stat or"><div class="val">${fcfa(deb.total)}</div><div class="lib">Commissions de déblocage</div><small>${deb.nb} déblocage(s)</small></div>
      <div class="stat or"><div class="val">${fcfa(alr.total)}</div><div class="lib">Alertes payantes</div><small>${alr.nb} alerte(s)</small></div>
    </div>

    <div class="carte">
      <h2>Revenus des 30 derniers jours</h2>
      <div class="graphe">${barres}</div>
      <div class="graphe-legende"><span>${echapper(s.par_jour[0].jour)}</span><span>${echapper(s.par_jour[s.par_jour.length - 1].jour)}</span></div>
    </div>

    <div class="carte">
      <h2>Revenus par mois</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Mois</th><th class="droite">Paiements</th><th class="droite">Revenus</th></tr></thead>
        <tbody>${lignesMois}</tbody>
      </table></div>
    </div>

    <h2>Activité</h2>
    <div class="stats-grille">
      <div class="stat"><div class="val">${totalDecl}</div><div class="lib">Déclarations au total</div></div>
      <div class="stat or"><div class="val">${decl.en_attente || 0}</div><div class="lib">En attente de validation</div></div>
      <div class="stat"><div class="val">${decl.publie || 0}</div><div class="lib">Publiées</div></div>
      <div class="stat gris"><div class="val">${decl.restitue || 0}</div><div class="lib">Restituées</div><small>Taux de restitution : ${taux} %</small></div>
      <div class="stat rouge"><div class="val">${decl.rejete || 0}</div><div class="lib">Rejetées</div></div>
      <div class="stat rouge"><div class="val">${s.signalements_a_traiter}</div><div class="lib">Signalements à traiter</div></div>
      <div class="stat or"><div class="val">${s.alertes_a_traiter}</div><div class="lib">Alertes avec document trouvé</div><small>${s.alertes_actives} alerte(s) active(s)</small></div>
    </div>`;
}

// ============ DÉCLARATIONS ============

async function chargerDeclarations(page = etatDecl.page) {
  etatDecl.page = page;
  const q = new URLSearchParams({ page, statut: $('decl-filtre').value, search: $('decl-recherche').value.trim() });
  const r = await api(`/declarations?${q}`);

  $('decl-liste').innerHTML = r.donnees.length
    ? `<table><thead><tr><th>N°</th><th>Date</th><th>Type</th><th>Nom sur le document</th><th>Ville</th><th>Déclarant</th><th>Mode</th><th>Statut</th><th class="droite">Déblocages</th><th></th></tr></thead>
       <tbody>${r.donnees.map((d) => `
         <tr>
           <td>#${d.id}</td>
           <td>${dateFr(d.date_creation)}</td>
           <td>${echapper(d.type_document)}</td>
           <td><strong>${echapper(d.nom_complet)}</strong></td>
           <td>${echapper(d.ville)}</td>
           <td>${d.anonyme ? '<em>Anonyme</em>' : `${vide(d.declarant_nom)}<br><small>${vide(d.declarant_telephone)}</small>`}</td>
           <td>${d.mode === 'garde' ? 'Gardé' : 'Déposé'}</td>
           <td>${tag(d.statut)}</td>
           <td class="droite">${d.nb_deblocages}</td>
           <td><button class="petit" data-action="detail" data-id="${d.id}">Détails</button></td>
         </tr>`).join('')}</tbody></table>`
    : '<p class="vide">Aucune déclaration.</p>';
  $('decl-pagination').innerHTML = htmlPagination(r.pagination, 'page-decl');
}

let minuteur;
$('decl-recherche').addEventListener('input', () => {
  clearTimeout(minuteur);
  minuteur = setTimeout(() => chargerDeclarations(1).catch((e) => toast(e.message, 'erreur')), 350);
});
$('decl-filtre').addEventListener('change', () => chargerDeclarations(1).catch((e) => toast(e.message, 'erreur')));

// ---------- Fiche détail ----------
async function ouvrirDetail(id) {
  const r = await api(`/declarations/${id}`);
  const d = r.declaration;

  const boutons = [];
  if (d.statut === 'en_attente' || d.statut === 'rejete') boutons.push(`<button data-action="statut" data-id="${d.id}" data-statut="publie">Publier</button>`);
  if (d.statut === 'publie') boutons.push(`<button class="neutre" data-action="statut" data-id="${d.id}" data-statut="en_attente">Remettre en attente</button>`);
  if (d.statut === 'en_attente' || d.statut === 'publie') boutons.push(`<button class="danger" data-action="statut" data-id="${d.id}" data-statut="rejete">Rejeter</button>`);

  $('detail-titre').textContent = `Déclaration #${d.id}`;
  $('detail-contenu').innerHTML = `
    <div class="admin-photos">${r.images.map((i) => `<a href="${echapper(i.url)}" target="_blank" rel="noopener"><img src="${echapper(i.url)}" alt="Photo ${i.ordre}"></a>`).join('')}</div>

    <dl class="kv">
      <dt>Statut</dt><dd>${tag(d.statut)}</dd>
      <dt>Type de document</dt><dd>${echapper(d.type_document)}</dd>
      <dt>Nom sur le document</dt><dd><strong>${echapper(d.nom_complet)}</strong></dd>
      <dt>Ville</dt><dd>${echapper(d.ville)}</dd>
      <dt>Mode</dt><dd>${d.mode === 'garde' ? 'Le déclarant garde le document' : 'Document déposé dans un établissement'}</dd>
      <dt>Anonyme</dt><dd>${d.anonyme ? 'Oui' : 'Non'}</dd>
      <dt>Lieu de dépôt</dt><dd>${vide(d.lieu_depot_description)}</dd>
      <dt>Déclarant : nom</dt><dd>${vide(d.declarant_nom)}</dd>
      <dt>Déclarant : téléphone</dt><dd>${vide(d.declarant_telephone)}</dd>
      <dt>Déclarant : e-mail</dt><dd>${vide(d.declarant_email)}</dd>
      <dt>Déclarant : ville</dt><dd>${vide(d.declarant_ville)}</dd>
      <dt>Déclarant : quartier</dt><dd>${vide(d.declarant_quartier)}</dd>
      <dt>Déclaré le</dt><dd>${dateFr(d.date_creation)}</dd>
    </dl>

    <h2>Déblocages (${r.deblocages.length})</h2>
    ${r.deblocages.length
      ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Propriétaire</th><th>Téléphone</th><th>Montant</th><th>Statut</th></tr></thead>
         <tbody>${r.deblocages.map((b) => `<tr><td>${dateFr(b.date_creation)}</td><td>${echapper(b.proprietaire_nom)}</td><td>${echapper(b.proprietaire_telephone)}</td><td>${fcfa(b.montant)}</td><td>${tag(b.statut)}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="vide">Personne n\'a encore débloqué cette déclaration.</p>'}

    ${boutons.length ? `<div class="actions">${boutons.join('')}</div>` : ''}`;
  $('modal-detail').classList.add('ouvert');
}

function fermerDetail() { $('modal-detail').classList.remove('ouvert'); }
$('detail-fermer').addEventListener('click', fermerDetail);
$('modal-detail').addEventListener('click', (e) => { if (e.target === $('modal-detail')) fermerDetail(); });

async function changerStatut(id, statut) {
  if (statut === 'rejete' && !confirm('Rejeter cette déclaration ? Elle disparaîtra des recherches.')) return;
  const r = await api(`/declarations/${id}/statut`, { method: 'PUT', body: JSON.stringify({ statut }) });
  toast(r.message);
  if (r.alertes_correspondantes > 0) toast(`${r.alertes_correspondantes} alerte(s) attendent ce document : voir l'onglet Alertes`, 'info');
  fermerDetail();
  await chargerDeclarations();
  rafraichirPastilles();
}

// ============ SIGNALEMENTS ============

async function chargerSignalements() {
  const lignes = await api('/deblocages?statut=signale');
  $('sign-liste').innerHTML = lignes.length
    ? `<table><thead><tr><th>Date</th><th>Document</th><th>Déclarant</th><th>Propriétaire (a signalé)</th><th>Déclaration</th><th>Actions</th></tr></thead>
       <tbody>${lignes.map((b) => `
         <tr>
           <td>${dateFr(b.date_creation)}</td>
           <td><strong>${echapper(b.nom_complet)}</strong><br><small>${echapper(b.type_document)}</small></td>
           <td>${vide(b.declarant_nom)}<br><small>${vide(b.declarant_telephone)}</small></td>
           <td>${echapper(b.proprietaire_nom)}<br><small>${echapper(b.proprietaire_telephone)}</small></td>
           <td>${tag(b.statut_declaration)}</td>
           <td><div class="sur-tableau-bouton">
             <button class="petit neutre" data-action="detail" data-id="${b.declaration_id}">Voir</button>
             ${b.statut_declaration === 'rejete'
               ? '<span class="vide">Traité</span>'
               : `<button class="petit danger" data-action="resoudre" data-id="${b.id}" data-decision="fraude">Confirmer la fraude</button>
                  <button class="petit" data-action="resoudre" data-id="${b.id}" data-decision="ecarter">Écarter</button>`}
           </div></td>
         </tr>`).join('')}</tbody></table>`
    : '<p class="vide">Aucun signalement.</p>';
}

async function resoudre(id, decision) {
  const msg = decision === 'fraude'
    ? 'Confirmer la fraude ? La déclaration sera rejetée.'
    : 'Écarter le signalement ? La déclaration redeviendra visible dans les recherches.';
  if (!confirm(msg)) return;
  const r = await api(`/deblocages/${id}/resoudre`, { method: 'PUT', body: JSON.stringify({ decision }) });
  toast(r.message);
  await chargerSignalements();
  rafraichirPastilles();
}

// ============ ALERTES ============

async function chargerAlertes() {
  const lignes = await api(`/alertes?statut=${encodeURIComponent($('alerte-filtre').value)}`);
  // Les alertes avec un document trouvé passent en premier
  lignes.sort((a, b) => (b.correspondances.length > 0) - (a.correspondances.length > 0));

  $('alertes-liste').innerHTML = lignes.length
    ? lignes.map((a) => {
        const match = a.statut === 'active' && a.correspondances.length > 0;
        return `<div class="carte-alerte ${match ? 'match' : ''}">
          <h3>${echapper(a.nom_complet)} ${tag(a.statut)}</h3>
          <p>${echapper(a.type_document)} · ${echapper(a.ville)} · demandée le ${dateFr(a.date_creation)}</p>
          <p>Téléphone : <a href="tel:${echapper(a.telephone)}"><strong>${echapper(a.telephone)}</strong></a>
             ${a.email ? ` · E-mail : <a href="mailto:${echapper(a.email)}">${echapper(a.email)}</a>` : ''}</p>
          ${match ? `<p><strong>Document retrouvé :</strong> ${a.correspondances.map((c) => `<button class="petit" data-action="detail" data-id="${c.id}">Déclaration #${c.id}</button>`).join(' ')}</p>` : ''}
          ${a.statut === 'active' ? `<div class="actions"><button class="petit" data-action="notifiee" data-id="${a.id}">Marquer comme prévenu</button></div>` : ''}
        </div>`;
      }).join('')
    : '<p class="vide">Aucune alerte.</p>';
}
$('alerte-filtre').addEventListener('change', () => chargerAlertes().catch((e) => toast(e.message, 'erreur')));

async function marquerPrevenu(id) {
  if (!confirm('Confirmer que cette personne a été prévenue (mail et appel) ?')) return;
  const r = await api(`/alertes/${id}/notifiee`, { method: 'PUT' });
  toast(r.message);
  await chargerAlertes();
  rafraichirPastilles();
}

// ============ PAIEMENTS ============

async function chargerPaiements(page = etatPay.page) {
  etatPay.page = page;
  const q = new URLSearchParams({ page, type: $('pay-filtre').value });
  const r = await api(`/paiements?${q}`);

  $('pay-liste').innerHTML = r.donnees.length
    ? `<table><thead><tr><th>N°</th><th>Date</th><th>Type</th><th>Téléphone</th><th>Référence</th><th>Statut</th><th class="droite">Montant</th></tr></thead>
       <tbody>${r.donnees.map((p) => `
         <tr>
           <td>#${p.id}</td>
           <td>${dateFr(p.date_creation)}</td>
           <td>${p.type === 'deblocage' ? 'Déblocage' : 'Alerte'}</td>
           <td>${vide(p.telephone_payeur)}</td>
           <td><small>${vide(p.reference_monetbil)}</small> ${p.simule ? '<span class="st st-simule">Simulé</span>' : ''}</td>
           <td>${tag(p.statut)}</td>
           <td class="droite"><strong>${fcfa(p.montant)}</strong></td>
         </tr>`).join('')}</tbody></table>`
    : '<p class="vide">Aucun paiement.</p>';
  $('pay-pagination').innerHTML = htmlPagination(r.pagination, 'page-pay');
}
$('pay-filtre').addEventListener('change', () => chargerPaiements(1).catch((e) => toast(e.message, 'erreur')));

// ============ ACTIONS (délégation d'événements) ============

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const { action, id, statut, page, decision } = el.dataset;
  try {
    if (action === 'detail') await ouvrirDetail(id);
    if (action === 'statut') await changerStatut(id, statut);
    if (action === 'resoudre') await resoudre(id, decision);
    if (action === 'notifiee') await marquerPrevenu(id);
    if (action === 'page-decl') await chargerDeclarations(parseInt(page));
    if (action === 'page-pay') await chargerPaiements(parseInt(page));
  } catch (err) {
    toast(err.message, 'erreur');
  }
});

// ============ DÉMARRAGE ============

(async function init() {
  if (!token) return;
  try {
    await api('/stats');
    afficherAdmin();
  } catch { /* session invalide : l'écran de connexion reste affiché */ }
})();
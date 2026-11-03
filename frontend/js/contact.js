// contact.js : coordonnées affichées dans la page Aide (rubrique « Nous contacter »)
//
// ===== À REMPLIR =====
// Laissez '' pour masquer un lien. Seuls les liens renseignés sont affichés.
const CONTACT_SITE = {
  whatsapp: '242055015300',   // numéro international, sans + ni espaces. Exemple : '242060000000'
  email: 'reelndoukou@gmail.com',      // Exemple : 'contact@monsite.cg'
  tiktok: '',     // lien complet en https. Exemple : 'https://www.tiktok.com/@monprofil'
  facebook: '',   // lien complet en https. Exemple : 'https://www.facebook.com/mapage'
  linkedin: '',   // lien complet en https. Exemple : 'https://www.linkedin.com/company/mapage'
};
// =====================

(function () {
  var zone = document.getElementById('liste-contacts');
  if (!zone) return;

  var liens = [];

  var wa = String(CONTACT_SITE.whatsapp || '').replace(/\D/g, '');
  if (wa.length >= 8) {
    liens.push({
      nom: 'WhatsApp',
      detail: '+' + wa,
      href: 'https://wa.me/' + wa + '?text=' + encodeURIComponent("Bonjour, j'ai besoin d'aide sur Documents Perdus."),
    });
  }

  var mail = String(CONTACT_SITE.email || '').trim();
  if (/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(mail)) {
    liens.push({ nom: 'E-mail', detail: mail, href: 'mailto:' + mail });
  }

  [['tiktok', 'TikTok', 'Suivez-nous'], ['facebook', 'Facebook', 'Notre page'], ['linkedin', 'LinkedIn', 'Notre page']]
    .forEach(function (r) {
      var url = String(CONTACT_SITE[r[0]] || '').trim();
      // Seuls les liens https sont acceptés (pas de javascript: ni d'autre schéma)
      if (/^https:\/\/[^\s"'<>]+$/i.test(url)) liens.push({ nom: r[1], detail: r[2], href: url });
    });

  if (liens.length === 0) {
    var vide = document.createElement('p');
    vide.className = 'vide';
    vide.textContent = 'Nos coordonnées seront bientôt disponibles.';
    zone.appendChild(vide);
    return;
  }

  liens.forEach(function (l) {
    var a = document.createElement('a');
    a.className = 'contact-lien';
    a.href = l.href;
    if (l.href.indexOf('mailto:') !== 0) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }

    var nom = document.createElement('span');
    nom.className = 'nom';
    nom.textContent = l.nom;
    var detail = document.createElement('span');
    detail.className = 'detail';
    detail.textContent = l.detail;

    a.appendChild(nom);
    a.appendChild(detail);
    zone.appendChild(a);
  });
})();

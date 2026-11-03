// demarrage.js : écran de démarrage animé + enregistrement du service worker (installation)

(function () {
  var splash = document.getElementById('splash');

  // L'écran de démarrage s'affiche une fois par session (l'en-tête ajoute « splash-skip »
  // s'il a déjà été vu ou si l'on revient d'un paiement).
  if (splash && !document.documentElement.classList.contains('splash-skip')) {
    var reduit = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var dureeMin = reduit ? 600 : 2800;   // le temps de voir l'animation des lettres
    var debut = Date.now();
    var chargee = document.readyState === 'complete';
    var ferme = false;

    var fermer = function () {
      if (ferme) return;
      ferme = true;
      try { sessionStorage.setItem('dp_splash', '1'); } catch (e) { /* stockage indisponible */ }
      splash.classList.add('sortie');
      setTimeout(function () {
        if (splash.parentNode) splash.parentNode.removeChild(splash);
        document.body.classList.remove('splash-actif');
      }, 700);
    };

    var planifier = function () {
      var reste = dureeMin - (Date.now() - debut);
      if (reste > 0) setTimeout(fermer, reste); else fermer();
    };

    document.body.classList.add('splash-actif');
    if (chargee) planifier();
    else window.addEventListener('load', function () { chargee = true; planifier(); });

    setTimeout(fermer, 8000); // sécurité : on ne bloque jamais le site
  }

  // Service worker : nécessaire pour que le navigateur propose « Installer l'application »
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () { /* sans conséquence */ });
    });
  }
})();

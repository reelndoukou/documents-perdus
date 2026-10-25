-- =========================================================
-- Documents Perdus : schéma de base de données
-- =========================================================

DROP TABLE IF EXISTS alertes;
DROP TABLE IF EXISTS deblocages;
DROP TABLE IF EXISTS paiements;
DROP TABLE IF EXISTS images_declaration;
DROP TABLE IF EXISTS declarations;
DROP TABLE IF EXISTS types_document;
DROP TABLE IF EXISTS parametres;
DROP TABLE IF EXISTS admins;

-- ---------------------------------------------------------
-- Paramètres modifiables sans toucher au code (prix, etc.)
-- ---------------------------------------------------------
CREATE TABLE parametres (
    cle VARCHAR(50) PRIMARY KEY,
    valeur VARCHAR(255) NOT NULL
);

-- ---------------------------------------------------------
-- Types de documents (passeport, CNI, livret...)
-- ---------------------------------------------------------
CREATE TABLE types_document (
    id SERIAL PRIMARY KEY,
    libelle VARCHAR(100) NOT NULL UNIQUE
);

-- ---------------------------------------------------------
-- Déclarations de documents TROUVÉS
-- ---------------------------------------------------------
CREATE TABLE declarations (
    id SERIAL PRIMARY KEY,
    type_document_id INTEGER NOT NULL REFERENCES types_document(id) ON DELETE RESTRICT,

    -- Titre = nom complet figurant sur le document
    nom_complet VARCHAR(200) NOT NULL,
    -- Version normalisée (sans accents, minuscules, mots triés) pour la recherche
    nom_recherche VARCHAR(200) NOT NULL,
    ville VARCHAR(100) NOT NULL,

    -- 'garde'  : le déclarant garde le document sur lui
    -- 'depose' : le déclarant l'a déposé dans un établissement public
    mode VARCHAR(10) NOT NULL CHECK (mode IN ('garde', 'depose')),
    anonyme BOOLEAN NOT NULL DEFAULT FALSE,

    -- Mode 'depose' : où le document a été laissé
    lieu_depot_description TEXT,

    -- Coordonnées du déclarant (masquées tant que la commission n'est pas payée)
    declarant_nom VARCHAR(150),
    declarant_telephone VARCHAR(30),
    declarant_email VARCHAR(150),
    declarant_ville VARCHAR(100),
    declarant_quartier VARCHAR(100),

    statut VARCHAR(15) NOT NULL DEFAULT 'en_attente'
        CHECK (statut IN ('en_attente', 'publie', 'restitue', 'rejete')),
    date_creation TIMESTAMP NOT NULL DEFAULT NOW(),

    -- Mode 'garde' : coordonnées obligatoires, anonymat interdit
    CONSTRAINT chk_mode_garde CHECK (
        mode <> 'garde' OR (
            anonyme = FALSE
            AND declarant_nom IS NOT NULL
            AND declarant_telephone IS NOT NULL
        )
    ),
    -- Mode 'depose' : la description du lieu est obligatoire
    CONSTRAINT chk_mode_depose CHECK (
        mode <> 'depose' OR lieu_depot_description IS NOT NULL
    )
);

-- ---------------------------------------------------------
-- Photos du document (2 par déclaration)
-- ---------------------------------------------------------
CREATE TABLE images_declaration (
    id SERIAL PRIMARY KEY,
    declaration_id INTEGER NOT NULL REFERENCES declarations(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    ordre SMALLINT NOT NULL DEFAULT 1
);

-- ---------------------------------------------------------
-- Paiements encaissés via MonetBil
-- ---------------------------------------------------------
CREATE TABLE paiements (
    id SERIAL PRIMARY KEY,
    type VARCHAR(15) NOT NULL CHECK (type IN ('deblocage', 'alerte')),
    montant INTEGER NOT NULL,
    statut VARCHAR(15) NOT NULL DEFAULT 'en_attente'
        CHECK (statut IN ('en_attente', 'reussi', 'echoue')),
    reference_monetbil VARCHAR(100),
    transaction_id VARCHAR(100),
    donnees JSONB,
    telephone_payeur VARCHAR(30),
    date_creation TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX ux_paiements_reference ON paiements(reference_monetbil) WHERE reference_monetbil IS NOT NULL;

-- ---------------------------------------------------------
-- Déblocages : un propriétaire a payé pour contacter le déclarant
-- ---------------------------------------------------------
CREATE TABLE deblocages (
    id SERIAL PRIMARY KEY,
    token UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    declaration_id INTEGER NOT NULL REFERENCES declarations(id) ON DELETE RESTRICT,
    paiement_id INTEGER NOT NULL REFERENCES paiements(id) ON DELETE RESTRICT,
    proprietaire_nom VARCHAR(150) NOT NULL,
    proprietaire_telephone VARCHAR(30) NOT NULL,
    statut VARCHAR(15) NOT NULL DEFAULT 'debloque'
        CHECK (statut IN ('debloque', 'restitue', 'signale')),
    date_creation TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------
-- Alertes payantes : « prévenez-moi quand mon document sera retrouvé »
-- ---------------------------------------------------------
CREATE TABLE alertes (
    id SERIAL PRIMARY KEY,
    nom_complet VARCHAR(200) NOT NULL,
    nom_recherche VARCHAR(200) NOT NULL,
    type_document_id INTEGER NOT NULL REFERENCES types_document(id) ON DELETE RESTRICT,
    ville VARCHAR(100) NOT NULL,
    email VARCHAR(150),
    telephone VARCHAR(30) NOT NULL,
    paiement_id INTEGER NOT NULL REFERENCES paiements(id) ON DELETE RESTRICT,
    statut VARCHAR(15) NOT NULL DEFAULT 'active'
        CHECK (statut IN ('active', 'notifiee')),
    date_creation TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------
-- Comptes de l'équipe (modération, alertes)
-- ---------------------------------------------------------
CREATE TABLE admins (
    id SERIAL PRIMARY KEY,
    email VARCHAR(150) NOT NULL UNIQUE,
    mot_de_passe_hash VARCHAR(255) NOT NULL
);

-- ---------------------------------------------------------
-- Index
-- ---------------------------------------------------------
CREATE INDEX idx_decl_recherche ON declarations(nom_recherche, type_document_id, ville);
CREATE INDEX idx_decl_statut ON declarations(statut);
CREATE INDEX idx_images_decl ON images_declaration(declaration_id);
CREATE INDEX idx_alertes_recherche ON alertes(nom_recherche, type_document_id, ville);
CREATE INDEX idx_deblocages_decl ON deblocages(declaration_id);

-- ---------------------------------------------------------
-- Données initiales
-- ---------------------------------------------------------
INSERT INTO parametres (cle, valeur) VALUES
('commission_deblocage', '2000'),
('prix_alerte', '1000'),
('indemnite_conseillee_min', '1000'),
('delai_reessai_heures', '48');

INSERT INTO types_document (libelle) VALUES
('Passeport'),
('Carte nationale d''identité (Livret)'),
('Numéro d''identité unique (NUI)'),
('Permis de conduire'),
('Livret de famille'),
('Acte de naissance'),
('Carte d''électeur'),
('Carte d''étudiant'),
('Diplôme / Attestation'),
('Carte grise'),
('Autre');
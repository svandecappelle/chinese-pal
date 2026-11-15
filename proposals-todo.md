# Idées de fonctionnalités (à faire)

Propositions restantes, classées par public. Déjà faits : dictée (écoute), exercices sur les
phrases d'exemple, entraînement aux tons, statistiques personnelles, lecture assistée, mode
hors ligne (PWA), fil de révision par petits pas, Mes mots et notes personnelles (mots hors vocabulaire compris), textes gradués.

## Priorités

- **Rappel quotidien** : notification le soir (application installée, application Android) quand
  les pas du jour ne sont pas faits (« 2 petits pas t'attendent, 4 min »).
- **Prononciation à l'oral** : l'élève lit le mot à voix haute ; la reconnaissance vocale du
  navigateur (chinois) vérifie les syllabes et les tons.
- **Devoirs datés et suivi de classe** : voir Professeurs.

## Élèves

- **Mes mots, suite** : proposer au professeur les mots personnels de ses élèves (les plus gardés)
  pour les ajouter au vocabulaire commun.
- **Textes gradués, suite** : plus de textes (HSK 4 et au-delà), textes ajoutés par les
  professeurs, « lu » enregistré sur le compte plutôt que sur l'appareil, audio du texte entier.
- **Petits dialogues audio** avec des questions de compréhension : écouter des phrases entières,
  pas seulement des mots.
- **Décomposition des caractères** : clés, composants, caractères qui partagent un composant.
- **Mini-jeux** : memory caractère ↔ pinyin, contre-la-montre sur les tons.
- **Lecture assistée, suite** : reconnaître les noms propres (小明 est découpé 小 / 明) ; traduire
  en français les sens de CC-CEDICT (aujourd'hui en anglais hors vocabulaire).
- **Fil de révision, suite** : dans le suivi du professeur, la régularité de chaque élève (pas
  par jour).

## Professeurs

- **Devoirs datés** : un exercice à finir avant une date, qui l'a fait, qui est en retard.
- **Suivi plus fin** : régularité de chaque élève (pas du fil par jour), mots qui posent problème
  à toute la classe, export CSV de la progression.
- **Import de listes personnelles** : CSV ou collage « hanzi ; traduction », pinyin et
  classificateurs remplis par le dictionnaire, aperçu avant import.
- **Fiches imprimables de quiz** : en plus des fiches d'écriture, des quiz papier (sens → caractère,
  pinyin → sens) générés depuis un exercice, avec leur corrigé.

## Contenu

- **HSK 4 à 6 et HSK 3.0**, et d'autres listes thématiques : école, maison, émotions, achats,
  restaurant, voyage.

## Technique

- **Tests automatisés dans le dépôt** : tests de l'API (pytest, base jetable) lancés à chaque
  push, au lieu de scripts d'essai ponctuels.
- **Hors ligne, suite** : préparer d'avance un exercice pour le hors ligne (tracés et audio de tous
  ses mots) ; noter la date réelle des réponses données hors ligne.

# Bavardage : messagerie avec vérification par e-mail ou SMS

Vraies discussions en temps réel entre utilisateurs. Connexion par code reçu par e-mail ou par SMS.

## 1. Tester sur votre ordinateur (5 minutes)
1. Installez Node.js 18 ou plus : https://nodejs.org
2. Dans ce dossier : `npm install` puis `npm start`
3. Ouvrez http://localhost:3000
4. Sans clés d'envoi, le code (e-mail ou SMS) s'affiche dans le terminal (mode test).
5. Si vous aviez testé une version précédente, supprimez le fichier `bavardage.db` avant de relancer.

## 2. Envoyer de vrais e-mails (Brevo, gratuit : 300 e-mails par jour)
1. Créez un compte sur https://www.brevo.com
2. Menu « Expéditeurs, domaines » > Expéditeurs : ajoutez votre adresse e-mail et validez-la avec le lien reçu.
3. Menu « SMTP et API » > Clés API : créez une clé et copiez-la.
4. Vous aurez deux valeurs : `BREVO_API_KEY` (la clé) et `MAIL_FROM` (l'adresse validée).

## 3. Envoyer de vrais SMS (Twilio Verify)
1. Créez un compte sur https://www.twilio.com et validez votre numéro.
2. Dans la console, ouvrez « Verify » > « Services » > « Create new » : nommez-le « Bavardage », activez le canal SMS. Copiez le **Service SID** (il commence par `VA`).
3. Sur l'accueil de la console, copiez l'**Account SID** (`AC…`) et l'**Auth Token**.
4. Vous aurez trois valeurs : `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SID`.
5. Un compte d'essai n'envoie des SMS qu'aux numéros que vous avez vérifiés dans la console. Pour écrire à n'importe qui, passez le compte en payant (ajout de crédit). Chaque code coûte quelques centimes.
6. Quand un numéro est vérifié par SMS, il appartient à son propriétaire : il remplace toute déclaration non vérifiée du même numéro.

## 4. Mettre en ligne (Render)
1. Créez un compte GitHub, puis un dépôt, et envoyez-y tous les fichiers de ce dossier (bouton « Add file > Upload files »). Il n'y a aucun sous-dossier : tout est au même niveau.
2. Créez un compte sur https://render.com > New > Web Service > choisissez votre dépôt.
3. Réglages : Build Command `npm install`, Start Command `npm start`.
4. Dans Environment, ajoutez `NODE_VERSION` = `20` et les clés des services que vous utilisez : `BREVO_API_KEY` et `MAIL_FROM` pour l'e-mail, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` et `TWILIO_VERIFY_SID` pour le SMS.
5. Lancez le déploiement. Render vous donne une adresse du type https://bavardage.onrender.com : c'est votre appli, partagez-la.

## 5. Proposer l'appli en APK (Android)
L'appli est installable (PWA) : manifeste, icônes et service worker sont déjà inclus. Sans APK, les utilisateurs peuvent déjà l'installer depuis Chrome : menu ⋮ > « Installer l'application ».

Pour créer un vrai fichier APK :
1. Mettez d'abord l'appli en ligne (étape 4) et notez son adresse, par exemple https://bavardage.onrender.com
2. Allez sur https://www.pwabuilder.com, collez l'adresse et lancez l'analyse.
3. Cliquez « Package for stores » > Android > « Generate package », puis téléchargez le fichier zip.
4. Dans le zip, prenez le fichier `.apk` signé, renommez-le `bavardage.apk` et placez-le à côté de `server.js` dans le projet.
5. Mettez le projet à jour sur GitHub : Render redéploie tout seul.
6. La page de téléchargement est alors disponible à l'adresse https://votre-adresse/download.html
7. Gardez précieusement le fichier de clé de signature fourni par PWABuilder : il est nécessaire pour toute mise à jour de l'appli.

Pour installer l'APK, les utilisateurs doivent autoriser « l'installation d'applications inconnues » pour leur navigateur. Pour être sur le Google Play Store, il faut un compte développeur Google (25 $, une seule fois).

## À savoir
- **Conservation des données** : sur l'offre gratuite de Render, le disque est effacé à chaque redéploiement. Pour garder comptes et messages, ajoutez un « Disk » (payant) monté sur `/data` et définissez `DB_PATH=/data/bavardage.db`.
- **Numéro de téléphone** : vérifié si la personne se connecte par SMS. Si elle se connecte par e-mail, son numéro est seulement déclaré, non vérifié.
- **Deux comptes distincts** : se connecter par e-mail ou par SMS crée deux comptes séparés, ils ne sont pas fusionnés.
- **Sécurité** : les messages sont stockés en clair sur votre serveur. Utilisez HTTPS (Render le fait automatiquement).

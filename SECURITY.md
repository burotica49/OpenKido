# Politique de sécurité

## Signaler une vulnérabilité

N'ouvrez **pas** d'issue publique. Écrivez à **a.roy@burotica.fr** avec :

- une description de la vulnérabilité et de son impact ;
- les étapes pour la reproduire (version d'Openkido, configuration, requêtes) ;
- si possible, une proposition de correctif.

Accusé de réception sous 3 jours ouvrés ; point d'avancement sous 14 jours.

## Versions supportées

Seule la dernière version publiée reçoit des correctifs de sécurité.

## Déploiement web : réglages obligatoires

L'instance web (Docker / Dokploy) doit définir :

- `AUTH_SECRET` — secret de signature des sessions, unique par instance ;
- `AUTH_URL` — URL publique de l'instance ;
- `ALLOWED_GITHUB_LOGINS` et/ou `ALLOWED_GITHUB_ORGS` — sans l'un des deux, n'importe quel compte GitHub peut se connecter.

L'application desktop embarque actuellement les identifiants de l'application OAuth : ne distribuez pas ses installeurs hors de l'organisation.

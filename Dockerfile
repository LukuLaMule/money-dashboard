# money.luku.fr — dashboard statique PEA/CTO
# Le CODE (html/css/js) est copié dans l'image ; les DONNÉES financières
# (data/intraday/daily/news/benchmarks/recap .json, régénérées par cron sur l'hôte)
# sont montées en volume sur /srv/data (voir nginx.conf + docker-compose.yml).
FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY html /usr/share/nginx/html

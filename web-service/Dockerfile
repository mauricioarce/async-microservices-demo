FROM node

ADD . /app/web-service
RUN cd /app/web-service; \
    npm install

ADD https://github.com/ufoscout/docker-compose-wait/releases/download/2.5.0/wait /wait
RUN chmod +x /wait

EXPOSE 3000

CMD /wait && node /app/web-service/web-service.js
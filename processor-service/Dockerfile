FROM node

ADD . /app/processor-service
RUN cd /app/processor-service; \
    npm install

ADD https://github.com/ufoscout/docker-compose-wait/releases/download/2.5.0/wait /wait
RUN chmod +x /wait

CMD /wait && node /app/processor-service/processor-service.js
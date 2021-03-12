SET HIVE=DEMO
SET HIVEPATH=W:/DEV/HIVE
SET CODEPATH=W:/DEV/CODE/zx-hive
docker build -t cogsmith/zx-hive %CODEPATH%
docker stop ZXHIVE_%HIVE%
docker rm ZXHIVE_%HIVE%
docker run -v /var/run/docker.sock:/var/run/docker.sock -v %HIVEPATH%/%HIVE%:/hive --name ZXHIVE_%HIVE% cogsmith/zx-hive --hive %HIVE% --hivepath %HIVEPATH% --cell ALL
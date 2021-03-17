FOR /F "tokens=4 delims= " %%i in ('route print ^| find " 0.0.0.0"') do SET MYIP=%%i
SET HIVE=DEMO
SET HIVEPATH=W:/DEV/HIVE
SET CODEPATH=W:/DEV/CODE/zx-hive
docker rmi --force cogsmith/helloworld-nodejs cogsmith/nodeinfo cogsmith/wx-static cogsmith/zx-hive cogsmith/zx-proxy
docker build -t cogsmith/zx-hive %CODEPATH%
docker stop ZXHIVE_%HIVE%
docker rm ZXHIVE_%HIVE%
docker run -v /var/run/docker.sock:/var/run/docker.sock -v %HIVEPATH%/%HIVE%:/hive --name ZXHIVE_%HIVE% cogsmith/zx-hive --hive %HIVE% --hivepath %HIVEPATH% --cell ALL --hivebind %MYIP%
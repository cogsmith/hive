FOR /F "tokens=4 delims= " %%i in ('route print ^| find " 0.0.0.0"') do SET MYIP=%%i
REM SET MYIP=127.0.0.1
SET HIVE=DEMO
SET HIVEPATH=W:/DEV/HIVE
SET CODEPATH=W:/DEV/CODE/hive
docker rmi --force cogsmith/helloworld-nodejs cogsmith/nodeinfo cogsmith/webgate cogsmith/hive cogsmith/webgate
docker build -t cogsmith/hive %CODEPATH%
docker stop ZXHIVE_%HIVE%
docker rm ZXHIVE_%HIVE%
docker run -v /var/run/docker.sock:/var/run/docker.sock -v %HIVEPATH%/%HIVE%:/hive --name ZXHIVE_%HIVE% --env HOST=0.0.0.0 --env PORT=99 -p %MYIP%:99:99 cogsmith/hive --hive %HIVE% --hivepath %HIVEPATH% --cell ALL --hivebind %MYIP% --hiveip %MYIP%
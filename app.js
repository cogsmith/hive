process.onSIGTERM = function () { process.exit(); }; process.on('SIGTERM', function () { process.onSIGTERM(); });

const fs = require('fs');
const path = require('path');

const _ = require('lodash');
const yaml = require('js-yaml');
const glob = require('glob');
const yargs = require('yargs/yargs');
const execa = require('execa');
const axios = require('axios').default;

const LOG = console.log;
LOG.Trace = LOG;
LOG.Debug = LOG;
LOG.Info = LOG;
LOG.Warn = LOG;
LOG.Error = LOG;
LOG.Fatal = LOG;
LOG.Null = function () { };

const fastify = require('fastify')({
	logger: true, maxParamLength: 999, ignoreTrailingSlash: false,
});

const AppJSON = require('./package.json');
const AppMeta = {
	Version: AppJSON.version || process.env.npm_package_version || '0.0.0',
	Name: AppJSON.namelong || AppJSON.name || 'App',
	Info: AppJSON.description || '',
}; AppMeta.Full = AppMeta.Name + ': ' + AppMeta.Info + ' [' + AppMeta.Version + ']';

const AppArgs =
	yargs(process.argv).wrap(125)
		.usage("\n" + AppMeta.Full + "\n\n" + 'USAGE: node $0 [options]')
		.epilog('DT: ' + new Date().toISOString() + "\n\n" + process.argv.join(' ') + "\n")
		.demandOption(['ip', 'port']) // ,'hivepath','hive'])
		.describe('v', 'Logging Level').default('v', 0).alias('v', 'verbose').count('verbose')
		.describe('ip', 'Bind IP').default('ip', process.env.HOST || '127.0.0.1')
		.describe('port', 'Bind Port').default('port', process.env.PORT || 99)
		.describe('hivepath', 'Hive Path').default('hivepath', '/hive')
		.describe('hive', 'Hive ID Name').default('hive', undefined)
		.describe('do', 'Action').default('do', 'run')
		.describe('cell', 'Cell ID')
		.describe('hiveip', 'Hive Public IP').default('hiveip', '127.0.0.1')
		.describe('hivebind', 'Hive Bind IP').default('hivebind', '127.0.0.1')
		.describe('admin', 'Admin IP').default('adminip', null).array('adminip')
		.showHelp('log')
		.argv; console.log(); // console.log(AppArgs);

const App = {
	AppJSON: AppJSON,
	Args: AppArgs,
	Meta: AppMeta,
	Requests: 0,
	Clients: {},
	Port: AppArgs.port,
	IP: AppArgs.ip,
	Hive: AppArgs.hive,
	HivePath: AppArgs.hivepath,
	Do: AppArgs.do.toUpperCase(),
	Cell: AppArgs.cell,
	HiveIP: AppArgs.hiveip,
	HiveBind: AppArgs.hivebind,
	AdminIP: AppArgs.adminip,
};

App.PortFirst = 9000;
App.PortNext = App.PortFirst + 1;
App.PortGet = function () { return App.PortNext++; }

App.PortDB = {};
App.CellDB = {};

App.RunInit = function () {
	fastify.log.info('App.RunInit');

	try { execa.commandSync('docker container stop $(docker container ls -q --filter name=ZX_' + App.Hive + '_*) ; docker container rm $(docker container ls -q --filter name=ZX_' + App.Hive + '_*)', { shell: true }).stdout.pipe(process.stdout); } catch (ex) { };

	fastify.register(require('fastify-compress'));

	fastify.addHook('onRequest', (req, rep, nxt) => {
		let reqip = req.socket.remoteAddress;
		App.Requests++; if (!App.Clients[reqip]) { App.Clients[reqip] = 1; } else { App.Clients[reqip]++; }
		nxt();
	});

	fastify.get('/', function (req, rep) { rep.send('ZX'); });

	fastify.get('/zx/hive/load', function (req, rep) { App.Load(req.query.cell); rep.send({ AX: 'ZX.Hive.Load', Q: req.query }); });
	fastify.get('/zx/hive/stop', function (req, rep) { App.Stop(req.query.cell); rep.send({ AX: 'ZX.Hive.Stop', Q: req.query }); });

	fastify.get('/zx/hive/nuke', function (req, rep) { App.Nuke(); rep.send({ AX: 'ZX.Hive.Nuke', Q: req.query }); });

	fastify.get('/zx/db/json', function (req, rep) { rep.send({ CellDB: App.CellDB, PortDB: App.PortDB }); });

	fastify.listen(App.Port, App.IP, (err, address) => { if (err) { LOG.Error(err); throw err; } else { fastify.log.info('App.RunInit:Done'); App.RunMain(); } });
}

App.Nuke = function () {
	execa.commandSync('docker container stop $(docker container ls -q --filter name=ZX*)', { shell: true }).stdout.pipe(process.stdout);
	execa.commandSync('docker container rm   $(docker container ls -q --filter name=ZX*)', { shell: true }).stdout.pipe(process.stdout);
}

App.Stop = function (cell) {
	if (App.CellDB[cell]) {
		fastify.log.info('App.Stop = ' + cell);
		try {
			execa.commandSync('docker container stop $(docker container ls -q --filter name=ZX_' + App.Hive + '_' + App.CellDB[cell].Port + ')', { shell: true });
			execa.commandSync('docker container rm   $(docker container ls -q --filter name=ZX_' + App.Hive + '_' + App.CellDB[cell].Port + ')', { shell: true });
		} catch (ex) { }
	}
}

App.LoadCell = function (cell) {
	console.log('App.LoadCell: ' + cell);

	let cz = cell.split('/');

	let port = 0; if (App.CellDB[cell]) { port = App.CellDB[cell].Port; } else { port = App.PortGet(); }
	let slug = cz[0];
	let host = App.GetSlugHost(slug); let slughost = host;
	let type = 'HTML';
	let base = '/';
	let path = App.HivePath + '/' + App.Hive + '/' + slug + '/' + cz.slice(1).join('/');

	if (fs.existsSync('/hive' + '/' + cell + '/' + 'app.js')) { type = 'APPJS'; }
	if (fs.existsSync('/hive' + '/' + cell + '/' + 'docker.run')) { type = 'DOCKER-RUN'; }

	let z = { Port: port, Slug: slug, Host: host, Type: type, Base: base, Path: path, Cell: cell };

	if (z.Type == 'DOCKER-RUN') { z.Run = fs.readFileSync('/hive' + '/' + cell + '/' + 'docker.run') + ''; }

	App.PortDB[port] = z;
	App.CellDB[cell] = z;

	let RUN = [];

	let dockid = 'ZX_' + App.Hive + '_' + z.Port;
	let dockimg = ''; if (z.Type == 'DOCKER-RUN') { dockimg = z.Run.split(' ')[0]; }
	if (z.Type == 'HTML') { RUN.push("docker stop " + dockid + " ; docker rm " + dockid + " ; docker run --rm --name " + dockid + ' --env HIVESLUG=' + slug + ' --env SLUGHOST=' + slughost.toLowerCase() + " --env HOST=0.0.0.0 --env PORT=9 -p " + App.HiveBind + ":" + z.Port + ":9 -v " + z.Path + ":/www cogsmith/wx-static --port 9 --ip 0.0.0.0 --www /www"); }
	//if (z.Type == 'APPJS') { RUN.push("docker stop " + dockid + " ; docker rm " + dockid + " ; docker run --rm --name " + dockid + ' --env HIVESLUG=' + slug + ' --env SLUGHOST=' + slughost.toLowerCase() + " --env HOST=0.0.0.0 --env PORT=9 -p " + App.HiveBind + ":" + z.Port + ":9 -v " + z.Path + ":/app node node /app/app.js --port 9 --ip 0.0.0.0"); }
	if (z.Type == 'APPJS') { RUN.push("docker stop " + dockid + " ; docker rm " + dockid + " ; docker run --rm --name " + dockid + ' --env HIVESLUG=' + slug + ' --env SLUGHOST=' + slughost.toLowerCase() + " --env HOST=0.0.0.0 --env PORT=9 -p " + App.HiveBind + ":" + z.Port + ":9 -v " + z.Path + ":/app cogsmith/nodemon nodemon /app/app.js --port 9 --ip 0.0.0.0"); }
	if (z.Type == 'DOCKER-RUN') { RUN.push("docker stop " + dockid + " ; docker rm " + dockid + " ; docker run --rm --name " + dockid + ' --env HIVESLUG=' + slug + ' --env SLUGHOST=' + slughost.toLowerCase() + " --env HOST=0.0.0.0 --env PORT=9 -p " + App.HiveBind + ":" + z.Port + ":9 -v " + z.Path + "/data:/app/data " + z.Run + " --port 9 --ip 0.0.0.0"); }

	console.log(RUN);
	RUN.forEach(x => { console.log('CMD: ' + x); execa.command(x, { shell: true }).stdout.pipe(process.stdout); });

	let map = {};
	let kz = Object.keys(App.CellDB);
	kz.forEach((k) => {
		let z = App.CellDB[k];
		k = k.replace('/web/raw/@', '').replace('/web/raw/_', '/_').replace('/web/raw/', '/').replace('/web/app/@', '').replace('/web/app/_', '/_').replace('/web/app/', '/');
		let kk = App.GetSlugHost(k.toLowerCase());
		if (kk.startsWith('.')) { kk = kk.substr(1) + '_/*'; }
		console.log('K = ' + k + '  ||  ' + 'KK = ' + kk);
		// map[kk] = (!k.substr(-1) == '!' ? '@' : '') + 'http://' + App.HiveBind + ':' + z.Port;
		map[kk] = (!k.includes('/') ? '@' : '') + 'http://' + App.HiveBind + ':' + z.Port;
	});

	fs.mkdirSync('/hive/WEBGATE', { recursive: true });
	fs.writeFileSync('/hive/WEBGATE/HIVE.MAP', yaml.dump(map));
}

App.GetHostSlug = function (host) { let slug = host.replace(/\./g, '_').toUpperCase(); let z = slug.split('_'); if (z.length >= 3) { slug = z.slice(-2).join('_') + '_' + z.slice(0, z.length - 2).reverse().join('_'); }; return slug; };
App.GetSlugHost = function (slug) { let host = slug.replace(/_/g, '.'); let z = slug.split('_'); if (z.length >= 2) { host = _.concat(z.slice(2).reverse(), z.slice(0, 2)).join('.'); }; return host; };

App.LoadSlug = function (slug) {
	let slugpath = '/hive' + '/' + slug;
	let host = App.GetSlugHost(slug);
	LOG.Info('App.LoadSlug: ' + slug + ' @ ' + slugpath);

	let dirsraw = []; try { dirsraw = fs.readdirSync(slugpath + '/web/raw') } catch (ex) { }
	for (let i = 0; i < dirsraw.length; i++) {
		let x = dirsraw[i];
		if (glob.sync(slugpath + '/web/raw/' + x + '/' + '*.html').length > 0) { App.LoadCell(slug + '/' + 'web/raw' + '/' + x); }
	}

	let dirsapp = []; try { dirsapp = fs.readdirSync(slugpath + '/web/app') } catch (ex) { };
	for (let i = 0; i < dirsapp.length; i++) {
		let x = dirsapp[i];
		if (fs.existsSync(slugpath + '/web/app/' + x + '/' + 'app.js')) { App.LoadCell(slug + '/' + 'web/app' + '/' + x); }
		if (fs.existsSync(slugpath + '/web/app/' + x + '/' + 'docker.run')) { App.LoadCell(slug + '/' + 'web/app' + '/' + x); }
	}
}

App.LoadAll = function () {
	LOG.Info('App.LoadAll: ' + App.Hive);
	let hivepath = '/hive'; // let hivepath = App.HivePath;
	let slugs = fs.readdirSync(hivepath);
	for (let i = 0; i < slugs.length; i++) {
		let slug = slugs[i]; let host = App.GetSlugHost(slug);
		if (slug == 'ACME') { continue; }
		if (slug == 'WWW') { continue; } if (slug == 'ZWWW') { continue; }
		if (slug.startsWith('hive.')) { continue; }
		if (slug.startsWith('proxy.') || slug.startsWith('proxyauto.')) { continue; }
		if (slug.startsWith('redirect.') || slug.startsWith('redirectauto.')) { continue; }
		if (slug == 'ports.json') { continue; }
		App.LoadSlug(slug);
	}
}

App.Load = function (cell) {
	LOG.Info('App.Load: ' + cell);

	let slug = cell.split('/')[0];
	let slughost = App.GetSlugHost(slug);

	LOG.Debug("\n\n\n\n");
	LOG.Debug([App.HivePath, App.Hive]);
	LOG.Debug("\n\n\n\n");

	fs.mkdirSync('/hive/WWW/.well-known/acme-challenge', { recursive: true });
	fs.writeFileSync('/hive/WWW/.well-known/acme-challenge/acme.txt', 'ACME');

	let adminips = ''; for (let i = 0; i < App.AdminIP.length; i++) { let ip = App.AdminIP[i]; if (ip) { adminips += '--admin ' + ip + ' ' }; }
	let cmd = "docker stop ZXPROXY_" + App.Hive + " ; docker rm ZXPROXY_" + App.Hive + " ; docker run -t --name ZXPROXY_" + App.Hive + ' --env HIVESLUG=' + slug + ' --env SLUGHOST=' + slughost.toLowerCase() + " -p " + App.HiveBind + ":80:80 -p " + App.HiveBind + ":443:443 -v " + App.HivePath + "/" + App.Hive + ":/webgate cogsmith/hive-proxy " + adminips + " --public " + App.HiveIP + " --private " + App.HiveBind + " --to " + App.HiveBind + ' --mapfile WEBGATE/GATE.MAP --mapfile WEBGATE/HIVE.MAP --loglevel trace';
	console.log(cmd);
	execa.command(cmd, { shell: true }).stdout.pipe(process.stdout);

	if (cell == 'ALL') { return App.LoadAll(); }
	else if (!cell.split('/')[1]) { return App.LoadSlug(cell); }
	else { return App.LoadCell(cell); }
}

App.CallLoad = function (cell) {
	fastify.log.info('App.CallLoad = ' + cell);
	axios.get('http://127.0.0.1:99/zx/hive/load', { params: { cell: cell } }).then(function (res) { console.log(res.data); }).catch(function (err) { console.error(err); }); //.then(function () { console.log('AXIOS.THEN'); });
}

App.CallStop = function (cell) {
	fastify.log.info('App.CallStop = ' + cell);
	axios.get('http://127.0.0.1:99/zx/hive/stop', { params: { cell: cell } }).then(function (res) { console.log(res.data); }).catch(function (err) { console.error(err); }); //.then(function () { console.log('AXIOS.THEN'); });
}

App.Init = function () {
	fastify.log.info('App.Init');
	if (App.Do == 'NUKE') { App.Nuke(); }
	if (App.Do == 'RUN') { App.RunInit(); }
	if (App.Do == 'STOP') { App.CallStop(App.Cell); }
	if (App.Do == 'LOAD' || App.Do == 'RELOAD') { App.CallLoad(App.Cell); }
};

App.RunMain = function () {
	fastify.log.info('App.RunMain');
	if (App.Cell) { App.CallLoad(App.Cell); }
};

App.Init();
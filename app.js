const fs = require('fs');
const path = require('path');

const _ = require('lodash');
const yaml = require('js-yaml');
const glob = require('glob');
const yargs = require('yargs/yargs');
const execa = require('execa');
const axios = require('axios').default;

//

//const XT = require('/DEV/CODE/xtdev/node_modules/@cogsmith/xt').Init();
const XT = require('@cogsmith/xt').Init();
const LOG = XT.Log;
const App = XT.App;

//

const fastify = require('fastify')({
	logger: true, maxParamLength: 999, ignoreTrailingSlash: false,
});

App.InitArgs = function () {
	App.Argy = yargs(process.argv).wrap(125)
		.usage("\n" + App.Meta.Full + "\n\n" + 'USAGE: node $0 [options]')
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
		.describe('admin', 'Admin IP').default('adminip', null).array('adminip');

	let AppArgs = App.Argy.argv;
	App.Args = AppArgs;
	App.AdminIP = AppArgs.adminip;
	App.Requests = 0;
	App.Clients = {};
	App.Port = AppArgs.port;
	App.IP = AppArgs.ip;
	App.Hive = AppArgs.hive;
	App.HivePath = AppArgs.hivepath;
	App.Do = AppArgs.do.toUpperCase();
	App.Cell = AppArgs.cell;
	App.HiveIP = AppArgs.hiveip;
	App.HiveBind = AppArgs.hivebind;
}

App.InitData = function () {
	App.PortFirst = 9000;
	App.PortNext = App.PortFirst + 1;
	App.PortGet = function () { return App.PortNext++; }

	App.PortDB = {};
	App.CellDB = {};
}

App.RunInit = function () {
	LOG.DEBUG('App.RunInit');

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

	fastify.listen(App.Port, App.IP, (err, address) => { if (err) { LOG.ERROR(err); throw err; } else { LOG.DEBUG('App.RunInit:Done'); App.RunMain(); } });
}

App.Nuke = function () {
	execa.commandSync('docker container stop $(docker container ls -q --filter name=ZX*)', { shell: true }).stdout.pipe(process.stdout);
	execa.commandSync('docker container rm   $(docker container ls -q --filter name=ZX*)', { shell: true }).stdout.pipe(process.stdout);
}

App.Stop = function (cell) {
	if (App.CellDB[cell]) {
		LOG.INFO('App.Stop = ' + cell);
		try {
			execa.commandSync('docker container stop $(docker container ls -q --filter name=ZX_' + App.Hive + '_' + App.CellDB[cell].Port + ')', { shell: true });
			execa.commandSync('docker container rm   $(docker container ls -q --filter name=ZX_' + App.Hive + '_' + App.CellDB[cell].Port + ')', { shell: true });
		} catch (ex) { }
	}
}

App.LoadCell = function (cell) {
	LOG.DEBUG('App.LoadCell: ' + cell);

	let cz = cell.split('/');

	let slug = cz[0];
	let host = App.GetSlugHost(slug); let slughost = host;
	let type = 'HTML';
	let base = '/';
	let path = App.HivePath + '/' + App.Hive + '/' + slug + '/' + cz.slice(1).join('/');

	if (fs.existsSync('/hive' + '/' + cell + '/' + 'app.js')) { type = 'APPJS'; }
	if (fs.existsSync('/hive' + '/' + cell + '/' + 'docker.run')) { type = 'DOCKER-RUN'; }
	if (fs.existsSync('/hive' + '/' + cell + '/' + 'GOTO.URL')) { type = 'GOTO-URL'; }

	let port = 0; if (App.CellDB[cell]) { port = App.CellDB[cell].Port; } else if (type == 'HTML' && cell.substr(-1) == '@') { port = 88; } else { port = App.PortGet(); }
	let z = { Port: port, Slug: slug, Host: host, Type: type, Base: base, Path: path, Cell: cell };

	if (z.Type == 'DOCKER-RUN') { z.Run = fs.readFileSync('/hive' + '/' + cell + '/' + 'docker.run') + ''; }
	if (z.Type == 'GOTO-URL') { z.GotoURL = fs.readFileSync('/hive' + '/' + cell + '/' + 'GOTO.URL') + ''; }

	//console.log({Z:z});

	App.PortDB[port] = z;
	App.CellDB[cell] = z;

	let RUN = [];
	let runrun = false;

	let cellpath = '/hive' + '/' + cell + '/';

	LOG.DEBUG('Z.PATH: ' + z.Path);
	LOG.DEBUG('CELLPATH: ' + cellpath);

	let dockid = 'ZX_' + App.Hive + '_' + z.Port;
	let dockimg = ''; if (z.Type == 'DOCKER-RUN') { dockimg = z.Run.split(' ')[0]; }
	if (z.Type == 'HTML' && z.Port != 88) { runrun = "docker stop " + dockid + " ; docker rm " + dockid + " ; docker run --restart always --name " + dockid + ' --env HIVESLUG=' + slug + ' --env SLUGHOST=' + slughost.toLowerCase() + " --env HOST=0.0.0.0 --env PORT=9 -p " + App.HiveBind + ":" + z.Port + ":9 -v " + z.Path + ":/www cogsmith/webhost --port 9 --ip 0.0.0.0 --www /www --base /"; let basepath = cz.join('/').replace(slug + '/web/raw/', ''); if (basepath != '@') { runrun += basepath + '/' }; RUN.push(runrun); }
	if (z.Type == 'DOCKER-RUN') { RUN.push("docker stop " + dockid + " ; docker rm " + dockid + " ; docker run --restart always --name " + dockid + ' --env HIVESLUG=' + slug + ' --env SLUGHOST=' + slughost.toLowerCase() + " --env HOST=0.0.0.0 --env PORT=9 -p " + App.HiveBind + ":" + z.Port + ":9 -v " + z.Path + "/data:/app/data " + z.Run + " --port 9 --ip 0.0.0.0"); }

	//if (z.Type == 'APPJS') { RUN.push("docker stop " + dockid + " ; docker rm " + dockid + " ; docker run --restart always --name " + dockid + ' --env HIVESLUG=' + slug + ' --env SLUGHOST=' + slughost.toLowerCase() + " --env HOST=0.0.0.0 --env PORT=9 -p " + App.HiveBind + ":" + z.Port + ":9 -v " + z.Path + ":/app node node /app/app.js --port 9 --ip 0.0.0.0"); }
	//if (z.Type == 'APPJS') { RUN.push("docker stop " + dockid + " ; docker rm " + dockid + " ; docker run --restart always --name " + dockid + ' --env HIVESLUG=' + slug + ' --env SLUGHOST=' + slughost.toLowerCase() + " --env HOST=0.0.0.0 --env PORT=9 -p " + App.HiveBind + ":" + z.Port + ":9 -v " + z.Path + ":/app cogsmith/nodemon nodemon /app/app.js --port 9 --ip 0.0.0.0 --loglevel trace"); }

	//if (z.Type == 'APPJS') { if (!fs.existsSync(cellpath + '/package.json')) { RUN.push('echo \'{"dependencies":{"@cogsmith/xt":"*"}}\' > package.json'); } }
	if (z.Type == 'APPJS') { if (!fs.existsSync(cellpath + '/package.json')) { LOG.INFO('APPJS_NOPACKAGE'); fs.writeFileSync(cellpath + '/package.json', JSON.stringify({ dependencies: { '@cogsmith/xt': '*' } })); } }
	if (z.Type == 'APPJS') { RUN.push("cd " + cellpath + " ; docker stop " + dockid + " ; docker wait " + dockid + " ; docker rm " + dockid + " ; npm install ; docker run -d -t --restart always --name " + dockid + ' --env HIVESLUG=' + slug + ' --env SLUGHOST=' + slughost.toLowerCase() + " --env HOST=0.0.0.0 --env PORT=9 -p " + App.HiveBind + ":" + z.Port + ":9 -v " + z.Path + ":/app cogsmith/nodemon nodemon /app/app.js --port 9 --ip 0.0.0.0 --loglevel trace"); }

	//console.log(RUN);
	RUN.forEach(x => { LOG.DEBUG('LoadCell.CMD: ' + cell + "\n" + x); console.log(execa.commandSync(x, { shell: true }).stdout); });

	let map = {};
	let kz = Object.keys(App.CellDB);
	kz.forEach((k) => {
		let z = App.CellDB[k];
		k = k.replace('/web/raw/@', '').replace('/web/raw/_', '/_').replace('/web/raw/', '/').replace('/web/app/@', '').replace('/web/app/_', '/_').replace('/web/app/', '/');
		//let kk = App.GetSlugHost(k.toLowerCase());
		let kk = App.GetSlugHost(k);

		//console.log('K = ' + k + '  ||  ' + 'KK = ' + kk);

		if (kk.startsWith('.')) { kk = kk.substr(1); }
		if (kk.includes('/')) { kk = kk + '/*'; }
		// map[kk] = (!k.substr(-1) == '!' ? '@' : '') + 'http://' + App.HiveBind + ':' + z.Port;
		//map[mapkey] = (!k.includes('/') ? '@' : '') + 'http://' + App.HiveBind + ':' + z.Port;
		let mapkey = kk; // if (!kk.includes('/')) { } else { mapkey += '/*' };

		// map[mapkey] = z.GotoURL || '@' + 'http://' + App.HiveBind + ':' + z.Port;
		map[mapkey] = z.GotoURL || '^' + 'http://' + App.HiveBind + ':' + z.Port;

		//console.log('K = ' + k + '  ||  ' + 'KK = ' + kk + ' || ' + 'MAPKEY = ' + mapkey);
	});
	fs.mkdirSync('/hive/WEBGATE/MAPS', { recursive: true }); fs.writeFileSync('/hive/WEBGATE/MAPS/HIVE.MAP', yaml.dump(map));
}

//

App.GetHostSlug = function (host) { if (!host) { return host; } let slug = host.replace(/\./g, '_').toUpperCase(); let z = slug.split('_'); if (z.length >= 3) { slug = z.slice(-2).join('_') + '_' + z.slice(0, z.length - 2).reverse().join('_'); }; return slug; };
App.GetSlugHost = function (slug) { if (!slug) { return slug; } let host = slug.split('/')[0].replace(/_/g, '.'); let path = slug.split('/').slice(1).join('/') || ''; let z = host.split('.'); if (z.length >= 2) { host = z.slice(2).reverse().join('.') + '.' + z.slice(0, 2).join('.'); }; return host + (path ? '/' + path : ''); }

//

App.LoadSlug = function (slug) {
	let slugpath = '/hive' + '/' + slug;
	let host = App.GetSlugHost(slug);
	LOG.INFO('App.LoadSlug: ' + slug + ' @ ' + slugpath);

	let dirsraw = []; try { dirsraw = fs.readdirSync(slugpath + '/web/raw') } catch (ex) { }
	for (let i = 0; i < dirsraw.length; i++) {
		let x = dirsraw[i];
		if (glob.sync(slugpath + '/web/raw/' + x + '/' + '*.html').length > 0) { App.LoadCell(slug + '/' + 'web/raw' + '/' + x); }
		if (fs.existsSync(slugpath + '/web/raw/' + x + '/' + 'GOTO.URL')) { App.LoadCell(slug + '/' + 'web/raw' + '/' + x); }
	}

	let dirsapp = []; try { dirsapp = fs.readdirSync(slugpath + '/web/app') } catch (ex) { };
	for (let i = 0; i < dirsapp.length; i++) {
		let x = dirsapp[i];
		if (fs.existsSync(slugpath + '/web/app/' + x + '/' + 'app.js')) { App.LoadCell(slug + '/' + 'web/app' + '/' + x); }
		if (fs.existsSync(slugpath + '/web/app/' + x + '/' + 'docker.run')) { App.LoadCell(slug + '/' + 'web/app' + '/' + x); }
	}
}

App.LoadAll = function () {
	LOG.INFO('App.LoadAll: ' + App.Hive);
	let hivepath = '/hive'; // let hivepath = App.HivePath;
	let slugs = fs.readdirSync(hivepath);
	for (let i = 0; i < slugs.length; i++) {
		let slug = slugs[i]; let host = App.GetSlugHost(slug);
		if (slug == 'ACME') { continue; }
		if (slug == 'WWW') { continue; }
		if (slug == 'ZWWW') { continue; }
		if (slug == 'WEBGATE') { continue; }

		if (slug == 'SYNC.CMD') { continue; }
		if (slug == 'package.json') { continue; }

		/*
		if (slug.startsWith('hive.')) { continue; }
		if (slug.startsWith('proxy.') || slug.startsWith('proxyauto.')) { continue; }
		if (slug.startsWith('redirect.') || slug.startsWith('redirectauto.')) { continue; }
		if (slug == 'ports.json') { continue; }
		*/
		App.LoadSlug(slug);
	}
}

App.Load = function (cell) {
	LOG.INFO('App.Load: ' + cell);

	let slug = cell.split('/')[0];
	let slughost = App.GetSlugHost(slug);

	LOG.DEBUG([App.HivePath, App.Hive]);

	fs.mkdirSync('/hive/WWW/.well-known/acme-challenge', { recursive: true });
	fs.writeFileSync('/hive/WWW/.well-known/acme-challenge/acme.txt', 'ACME');

	let adminips = ''; for (let i = 0; i < App.AdminIP.length; i++) { let ip = App.AdminIP[i]; if (ip) { adminips += '--admin ' + ip + ' ' }; }
	let cmd = "docker stop ZXPROXY_" + App.Hive + " ; docker rm ZXPROXY_" + App.Hive + " ; docker run -t --restart always --name ZXPROXY_" + App.Hive + ' --env HIVESLUG=' + slug + ' --env SLUGHOST=' + slughost.toLowerCase() + " -p " + App.HiveBind + ":80:80 -p " + App.HiveBind + ":443:443 -v " + App.HivePath + "/" + App.Hive + ":/webgate cogsmith/webgate " + adminips + " --public " + App.HiveIP + " --private " + App.HiveBind + " --to " + App.HiveBind + ' --mapfile BASE.MAP --mapfile HIVE.MAP --mapfile GOTO.MAP --loglevel trace';
	LOG.DEBUG(cmd);
	execa.command(cmd, { shell: true }).stdout.pipe(process.stdout);

	let cmd88 = "docker stop ZXWEB_" + App.Hive + " ; docker rm ZXWEB_" + App.Hive + " ; docker run -t --restart always --name ZXWEB_" + App.Hive + ' --env HIVESLUG=' + slug + ' --env SLUGHOST=' + slughost.toLowerCase() + " -p " + App.HiveBind + ":88:9 -v " + App.HivePath + "/" + App.Hive + ":/webhost cogsmith/webhost --loglevel trace --port 9 --ip 0.0.0.0 --www /webhost --base / --vhost --xhost";
	LOG.DEBUG(cmd88);
	execa.command(cmd88, { shell: true }).stdout.pipe(process.stdout);

	setTimeout(function () {
		if (cell == 'ALL') { return App.LoadAll(); }
		else if (!cell.split('/')[1]) { return App.LoadSlug(cell); }
		else { return App.LoadCell(cell); }
	}, 2500);
}

App.CallLoad = function (cell) {
	LOG.INFO('App.CallLoad = ' + cell);
	axios.get('http://127.0.0.1:99/zx/hive/load', { params: { cell: cell } }).then(function (res) { console.log(res.data); }).catch(function (err) { console.error(err); }); //.then(function () { console.log('AXIOS.THEN'); });
}

App.CallStop = function (cell) {
	LOG.INFO('App.CallStop = ' + cell);
	axios.get('http://127.0.0.1:99/zx/hive/stop', { params: { cell: cell } }).then(function (res) { console.log(res.data); }).catch(function (err) { console.error(err); }); //.then(function () { console.log('AXIOS.THEN'); });
}

App.Init = function () {
	if (App.Do == 'NUKE') { App.Nuke(); }
	if (App.Do == 'RUN') { App.RunInit(); }
	if (App.Do == 'STOP') { App.CallStop(App.Cell); }
	if (App.Do == 'LOAD' || App.Do == 'RELOAD') { App.CallLoad(App.Cell); }
};

App.RunMain = function () {
	LOG.INFO('App.RunMain');
	if (App.Cell) { App.CallLoad(App.Cell); }
};

//

App.Run();
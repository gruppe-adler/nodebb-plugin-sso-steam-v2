'use strict';

const user = require.main.require('./src/user');
const db = require.main.require('./src/database');
const meta = require.main.require('./src/meta');
const nconf = require.main.require('nconf');
const passport = require.main.require('passport');
const passportSteam = require('passport-steam').Strategy;
const utils = require.main.require('./src/utils');
const authenticationController = require.main.require('./src/controllers/authentication');
const winston = require.main.require('winston');

const constants = Object.freeze({
	'name': 'Steam',
	'admin': {
		'route': '/plugins/sso-steam',
		'icon': 'fa-steam'
	}
});

const Steam = {};

function profileurl(steamid) {
	return 'https://steamcommunity.com/profiles/' + steamid;
}

Steam.init = async function (data) {
	function render(req, res) {
		res.render('admin/plugins/sso-steam', {});
	}
	data.router.get('/admin/plugins/sso-steam', data.middleware.admin.buildHeader, render);
	data.router.get('/api/admin/plugins/sso-steam', render);
};

Steam.linkAccount = async function (uid, steamid) {
	await user.setUserField(uid, 'steam-sso:steamid', steamid);
	await user.setUserField(uid, 'steam-sso:profile', profileurl(steamid));

	await db.setObjectField('steam-sso:uid-link', steamid, uid);
	await db.setObjectField('steam-sso:steamid-link', uid, steamid);
};

Steam.getStrategy = async function (strategies) {
	const nbbUrl = nconf.get('url');
	const settings = await meta.settings.get('sso-steam');

	if (settings && settings['key']) {
		passport.use(
			new passportSteam(
			{
				returnURL: nbbUrl + '/auth/steam/callback',
				realm: nbbUrl,
				apiKey: settings['key'],
				passReqToCallback: true
			},

			function (req, identifier, profile, done) {
				if (req.hasOwnProperty('user') && req.user.hasOwnProperty('uid') && req.user.uid > 0) {
					Steam.linkAccount(req.user.uid, profile.id).then(() => {
						done(null, req.user);
					}).catch(done);
					return;
				}

				Steam.login(profile.id, profile.displayName, profile._json.avatarfull).then(async (user) => {
					await authenticationController.onSuccessfulLogin(req, user.uid);
					done(null, user);
				}).catch(err => done(err));
			})
		);

		strategies.push({
			name: 'steam',
			url: '/auth/steam',
			callbackURL: '/auth/steam/callback',
			checkState: false,
			icon: constants.admin.icon,
			scope: 'user:username'
		});
	}

	return strategies;
};

Steam.getAssociation = async function (data) {
	const nbbUrl = nconf.get('url');
	const steamid = await Steam.getSteamidByUid(data.uid);

	if (steamid) {
		data.associations.push({
			associated: true,
			url: profileurl(steamid),
			steamid: steamid,
			name: constants.name,
			icon: constants.admin.icon
		});
	} else {
		data.associations.push({
			associated: false,
			url: nbbUrl + '/auth/steam',
			name: constants.name,
			icon: constants.admin.icon
		});
	}

	return data;
};

Steam.login = async function (steamid, username, avatar) {
	const uid = await Steam.getUidBySteamid(steamid);

	if (uid !== null) { // Existing User
		return { uid: uid };
	}

	// New User
	if (!utils.isUserNameValid(username)) {
		throw new Error('Invalid username! Your username can only contain alphanumeric letters (a-z, numbers, spaces).');
	}

	const newUid = await user.create({ username: username });
	await Steam.linkAccount(newUid, steamid);
	await user.setUserField(newUid, 'picture', avatar);

	return { uid: newUid };
};

Steam.getUidBySteamid = async function (steamid) {
	return db.getObjectField('steam-sso:uid-link', steamid);
};

Steam.getSteamidByUid = async function (uid) {
	return db.getObjectField('steam-sso:steamid-link', uid);
};

Steam.deleteUserData = async function (data) {
	const uid = data.uid;
	const steamid = await Steam.getSteamidByUid(uid);

	await user.auth.revokeAllSessions(uid);
	await db.deleteObjectField('steam-sso:uid-link', steamid);
	await db.deleteObjectField('steam-sso:steamid-link', uid);

	return uid;
};

Steam.addMenuItem = function (custom_header) {
	custom_header.authentication.push({
		'route': constants.admin.route,
		'icon': constants.admin.icon,
		'name': constants.name
	});

	return custom_header;
};

// Add some APIs for themes to use
Steam.addPostUserData = async function (data) {
	const steamid = await Steam.getSteamidByUid(data.uid);
	if (steamid !== null) {
		data['steam-sso:steamid'] = steamid;
		data['steam-sso:profile'] = profileurl(steamid);
	}
	return data;
};

module.exports = Steam;

"use strict";

const config = require('./../config');
const mysqlPool = require('mysql').createPool(config.mysql_connection_string);
const EventEmitter = require('events');

class Mysql extends EventEmitter {
	constructor() {
		super();

		this.getTotalRequestsNumber();
		this.getRecentSshCredentials();
		this.getMonthlyStats();
		setInterval(() => { this.getRecentSshCredentials(); }, 60 * 1000); // once a minute
		setInterval(() => { this.getMonthlyStats(); }, 3600 * 24 * 1000); // once a day
	}

	getTotalRequestsNumber() {
		mysqlPool.getConnection((err, connection) => {
			connection.query('SELECT COUNT(*) as cnt FROM request', (error, results, fields) => {
				connection.release();
				if (error) throw error;

				this.emit('total_requests_number', results[0].cnt);
			});
		});
	}

	getRecentSshCredentials() {
		mysqlPool.getConnection((err, connection) => {
			let query = `SELECT username, password FROM request WHERE username != '' ORDER BY id DESC LIMIT 0, 6`;
			connection.query(query, (error, results, fields) => {
				let rows = [];
				connection.release();
				if (error) throw error;
				results.forEach((row) => {
					rows.push({'username': row['username'], 'password': row['password']});
				});

				this.emit('recent_credentials', rows);
			});
		});
	}

	getMonthlyStats() {
		monthlyStats.services
			.then(monthlyStats.credentials)
			.then(monthlyStats.requests)
			.then(() => { this.emit('monthly_stats', monthlyStats.data); });
	}
}

const monthlyStats = {
	data: {},
	services: new Promise((resolve, reject) => {
		mysqlPool.getConnection((err, connection) => {
			let query = `
				SELECT 
					service,
					COUNT(*) AS total,
					(COUNT(*) / (SELECT COUNT(*) FROM request WHERE date >=  DATE_SUB(NOW(), INTERVAL 1 MONTH))) * 100 AS percentage
				FROM
					request
				WHERE date >=  DATE_SUB(NOW(), INTERVAL 1 MONTH)
				GROUP BY service
				ORDER BY total DESC
			`;
			connection.query(query, (error, results, fields) => {
				let rows = [];
				connection.release();
				if (error) throw error;
				results.forEach((row) => {
					rows.push({
						'service': row['service'],
						'total': row['total'],
						'percentage': row['percentage']
					});
				});
				monthlyStats.data['services'] = rows;
				resolve();
			});
		});
	}),
	credentials: new Promise((resolve, reject) => {
		mysqlPool.getConnection((err, connection) => {
			let query = `
				SELECT 
					CONCAT(username, ':',password) as credentials, COUNT(*) AS total
				FROM
					request
				WHERE date >=  DATE_SUB(NOW(), INTERVAL 1 MONTH) AND username IS NOT NULL AND username != ''
				GROUP BY username, password
				ORDER BY total DESC
				LIMIT 0, 256
			`;
			connection.query(query, (error, results, fields) => {
				let rows = [];
				connection.release();
				if (error) throw error;
				results.forEach((row) => {
					rows.push({
						'credentials': row['credentials'],
						'total': row['total']
					});
				});
				monthlyStats.data['credentials'] = rows;
				resolve();
			});
		});
	}),
	requests: new Promise((resolve, reject) => {
		mysqlPool.getConnection((err, connection) => {
			let query = `
				SELECT 
					http_request_path, COUNT(*) AS total
				FROM
					request
				WHERE date >=  DATE_SUB(NOW(), INTERVAL 1 MONTH) AND http_request_path IS NOT NULL
				GROUP BY http_request_path
				ORDER BY total DESC
				LIMIT 0, 256
			`;
			connection.query(query, (error, results, fields) => {
				let rows = [];
				connection.release();
				if (error) throw error;
				results.forEach((row) => {
					rows.push({
						'request': row['http_request_path'],
						'total': row['total']
					});
				});
				monthlyStats.data['requests'] = rows;
				resolve();
			});
		});
	})
};

const saveToDatabase = (item) => {
	let request = {
		'ip': item.ip,
		'service': item.service,
		'request': item.request,
		'request_headers': item.request_headers
	};
	if ('username' in item) request.username = item['username'];
	if ('password' in item) request.password = item['password'];
	if ('http_request_path' in item) request.http_request_path = item['http_request_path'];

	mysqlPool.getConnection((err, connection) => {
		let query = connection.query('INSERT INTO request SET ?', request, (error, results, fields) => {
			connection.release();
			if (error) throw error;
		});
	});
};

const formatHeaders = (headers, indent) => {
	if (typeof headers !== 'object' || headers.length === 0) return;
	indent = indent ? indent : '';
	let s = '';
	for (let key in headers) {
		let val = headers[key];
		if (typeof val === 'object' && val !== null) {
			s+= key + ':\r\n';
			s+= formatHeaders(val, indent + " - ");
		}
		else s+= indent + key + ': ' + val + '\r\n';
	}

	return s;
};

module.exports = {
	formatHeaders: formatHeaders,
	saveToDatabase: saveToDatabase,
	Mysql: Mysql
};
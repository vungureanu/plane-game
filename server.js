var app = require("express")();
var http = require("http").createServer(app);
var io = require("socket.io")(http);
var THREE = require("three");
var players = new Map();
const outer_radius = 150;
const center = new THREE.Vector3(outer_radius, outer_radius, outer_radius);
const inner_radius = 50;
const refresh_time = 100; // Milliseconds between successive refreshes
const trail_length = 100; // Maximum number of rectangles in plane's trail
const NORMAL_SPEED = 0.5;
const FAST_SPEED = 3;
const TURN_SPEED = 0.25;
var cell_dim = 50; // Side length of cubes into which space is partitioned for collision detection purposes
const initial_gas = 300;
const buffer = 20; // Determines player's new location after stepping out of bounds
var cur_id = 0;
var cells;
var n = 2 * Math.ceil(outer_radius/cell_dim); // Number of cubes per side
const epsilon = 1;
const initial_seconds = 30;
var seconds_left = initial_seconds;
var update_id;
var game_in_progress = false;
var timer;
const respawn_time = 1000;
const accepted_characters = /^[0-9 + a-z + A-Z + _]+$/;

http.listen(3000, function(){
	console.log('listening on *:3000');
});

app.get("/", function(req, res) {
	res.sendFile(__dirname + "/index.html");
});
app.get("/js/three.js", function(req, res) {
	res.sendFile(__dirname + "/js/three.js");
});
app.get("/js/client.js", function(req, res) {
	res.sendFile(__dirname + "/js/client.js");
});
app.get("/test.js", function(req, res) {
	res.sendFile(__dirname + "/test.js");
});
app.get("/textures/moon.jpg", function(req, res) {
	console.log("OK.");
	res.sendFile(__dirname + "/textures/moon.jpg");
});

function Player(player_id, user_name, socket) {
	THREE.Object3D.call(this);
	draw_plane.call(this);
	this.score = 0;
	if ( user_name.match(accepted_characters) ) {
		this.user_name = user_name;
	}
	else {
		this.user_name = "guest";
	}
	this.socket = socket;
	this.x_frac = 0;
	this.y_frac = 0; // Horizontal mouse position
	this.click = false, // Whether mouse is depressed
	this.player_id = player_id; // ID assigned to player
	deploy_player(this);
}

Player.prototype = Object.create(THREE.Object3D.prototype);
Player.prototype.constructor = Player;
Player.prototype.getEdges = function() {
	var edges = [];
	edges.push( {p1: this.left_guide.getWorldPosition(), p2: this.right_guide.getWorldPosition()} );
	edges.push( {p1: this.top_guide.getWorldPosition(), p2: this.left_guide.getWorldPosition()} );
	edges.push( {p1: this.top_guide.getWorldPosition(), p2: this.right_guide.getWorldPosition()} );
	return edges;
}

function update_world() {
	for ( var player of players.values() ) {
		if (player.deployed) {
			update_location(player);
			send_location(player);
			check_collisions(player);
		}
	}
}

/* SOCKET */

function destroy_player(id, reason, redeploy) {
	if ( players.has(id) ) {
		let player = players.get(id);
		console.log("Destroying", id, "because of", reason);
		player.deployed = false;
		io.emit("destroy", {id : id, reason : reason} );
		for (var collision_data of player.collision_data) {
			collision_data.cell.trails.delete(collision_data);
		}
		player.cell.planes.delete(id);
		if (redeploy) {
			console.log("Redeploying", id);
			setTimeout(redeploy_player.bind(null, player), respawn_time);
		}
		else {
			players.delete(id);
		}
	}
	else {
		console.log("Attempt to delete non-existent player:", id);
	}
}

function deploy_player(player) {
	player.deployed = true;
	player.gas = initial_gas;
	player.collision_data = [];
	player.trail = [];
	player.oob_flag = false;
	var r = Math.random() * (outer_radius - inner_radius - 2 * buffer) + inner_radius;
	var theta = Math.random() * 2 * Math.PI;
	var phi = Math.random() * Math.PI;
	player.position.set(
		r * Math.sin(theta) * Math.cos(phi),
		r * Math.sin(theta) * Math.sin(phi),
		r * Math.cos(theta)
	);
	player.position.addScalar(outer_radius);
	player.updateMatrixWorld();
	var coords = {
		left : player.left_guide.getWorldPosition(),
		right : player.right_guide.getWorldPosition()
	};
	player.cell = get_cell(player.position);
	player.cell.planes.add(player.player_id);
	for (var i = 0; i < trail_length-1; i++) {
		player.trail.push(coords);
		let collision_datum = {normal: new THREE.Vector3(0, 0, 0), cell: player.cell, id: player.player_id}; // Just taking up space.
		player.collision_data.push(collision_datum);
		player.cell.trails.add(collision_datum);
	}
	player.trail.push(coords);
}

function redeploy_player(player) {
	deploy_player(player);
	var msg = {
		id: player.player_id,
		pos: player.getWorldPosition(),
		rot: player.rotation,
		trail: player.trail
	};
	player.socket.broadcast.emit("add", msg);
	player.socket.emit("id", msg);
}

function update_location(player) {
	if (!player.deployed) {
		return false;
	} 
	var speed = (player.click && player.gas > 0) ? FAST_SPEED : NORMAL_SPEED;
	player.rotateZ(-player.x_frac * speed * TURN_SPEED);
	player.rotateX(-player.y_frac * speed * TURN_SPEED);
	player.translateY(speed);
	player.updateMatrixWorld();
	alter_bounds(player);
	player.cell.planes.delete(player.player_id);
	player.cell = get_cell(player.position);
	player.cell.planes.add(player.player_id);
	player.gas += 1.5 * NORMAL_SPEED - speed; 
	if (player.position.distanceToSquared(center) <= inner_radius * inner_radius) {
		destroy_player(player.player_id, "crash", true);
	}
	update_trail(player);
}

function send_location(player) {
	io.emit("update", {
		id: player.player_id, 
		pos: player.getWorldPosition(),
		rot: player.rotation,
		gas: player.gas
	});
}

io.on("connection", function(socket) {
	var player_id = cur_id;
	cur_id++;
	console.log("New connection from", socket.handshake.address);
	socket.on("start", function(user_name) {
		if (!game_in_progress) {
			update_id = setInterval(update_world, refresh_time);
			timer = setInterval(count_down, 1000);
			game_in_progress = true;
		}
		socket.emit("config", {
			initial_gas: initial_gas,
			trail_length: trail_length,
			inner_radius: inner_radius,
			outer_radius: outer_radius,
			seconds_left: seconds_left
		});
		var new_player = new Player(player_id, user_name, socket);
		var msg = {
			id: new_player.player_id,
			pos: new_player.position,
			rot: new_player.rotation,
			trail: new_player.trail
		};
		socket.emit("id", msg);
		for (var player of players.values()) {
			player.socket.emit("add", msg);
			socket.emit("add", {
				id: player.player_id,
				pos: player.getWorldPosition(),
				rot: player.rotation,
				trail: player.trail
			});
		}
		players.set(player_id, new_player);
	});
	socket.on("status", function(status) {
		if ( players.has(status.id) ) {
			players.get(status.id).x_frac = status.x_frac;
			players.get(status.id).y_frac = status.y_frac;
			players.get(status.id).click = status.click;
		}
		else if (status.id != -1) {
			console.log("Data received from unknown player:", status.id);
		}
	});
	socket.on( "disconnect", () => destroy_player(player_id, "disconnection", false) );
});

/* GRAPHICS */

function draw_plane() {
	var vertices = [
		new THREE.Vector3(0, 15, 0),
		new THREE.Vector3(-10, 0, 0),
		new THREE.Vector3(0, 5, 0),
		new THREE.Vector3(10, 0, 0)
	];
	this.left_guide = new THREE.Object3D();
	this.right_guide = new THREE.Object3D();
	this.top_guide = new THREE.Object3D();
	this.bottom_guide = new THREE.Object3D();
	this.add(this.left_guide);
	this.add(this.right_guide);
	this.add(this.top_guide);
	this.add(this.bottom_guide);
	this.left_guide.position.set(-10, 0, 0);
	this.right_guide.position.set(10, 0, 0);
	this.top_guide.position.set(0, 15, 0);
	this.bottom_guide.position.set(0, 5, 0);
}

function update_trail(player) {
	if (!player.collision_data[0].cell.trails.has(player.collision_data[0])) {
		console.log("Error!", player.collision_data[0].cell.trails);
	}
	player.collision_data[0].cell.trails.delete(player.collision_data[0]);
	player.collision_data.shift();
	var new_left = player.left_guide.getWorldPosition();
	var new_right = player.right_guide.getWorldPosition();
	var old_left = player.oob_flag ? new_left.clone() : player.trail[trail_length-1].left;
	var old_right = player.oob_flag ? new_right.clone() : player.trail[trail_length-1].right;
	var v1 = new_left.clone();
	v1.sub(old_left);
	var v2 = old_right.clone();
	v2.sub(old_left);
	var v3 = new THREE.Vector3().crossVectors(v1, v2); // If v1 and v2 are not parallel, then {v1, v2, v3} is a basis of R^3.
	v3.normalize(); // Not necessary
	var matrix = new THREE.Matrix3();
	matrix.set( 
		new_left.x - old_left.x, old_right.x - old_left.x, v3.x,
		new_left.y - old_left.y, old_right.y - old_left.y, v3.y,
		new_left.z - old_left.z, old_right.z - old_left.z, v3.z
	);
	try {
		matrix = matrix.getInverse(matrix, true);
	}
	catch(e) {
		console.log("Matrix not invertible:", matrix);
	}
	var center = old_left.clone();
	center.addScaledVector(v1, 0.5);
	center.addScaledVector(v2, 0.5);
	var cell = get_cell(center);
	var collision_data = {
		matrix: matrix,
		normal: v3,
		point: old_left,
		id: player.player_id,
		cell: cell
	};
	cell.trails.add(collision_data);
	player.collision_data.push(collision_data);
	player.trail.push( {left: new_left, right: new_right} );
	player.trail.shift();
}

/* INTERSECTION DETECTION */

/* Checks whether the line segment from "p1" to "p2" intersects the planar section given by "matrix".
The idea is that "matrix" represents a linear transformation which maps its associated trail rectangle to the unit
square ([0, 1] x [0, 1] x {0}).  We need only check whether a point lying within the plane containing the trail
rectangle is mapped to the unit square. */

function intersects(collision_data, edge /*p1, p2*/) {
	var p1 = edge.p1;
	var p2 = edge.p2;
	// Find intersection between line passing through "p1" and "p2" and plane given by "collision_data".
	var v = p2.clone();
	v.sub(p1);
	var dp = collision_data.normal.dot(v);
	if (dp == 0) { // Line and plane are parallel.
		return false;
	}
	var tmp_vec = collision_data.point.clone();
	tmp_vec.sub(p1);
	var c = tmp_vec.dot(collision_data.normal) / dp;
	if (c < 0 || c > 1) {
		return false;
	}
	// Intersection occurs on line segment connecting "point" to "point" + "v".
	point_of_intersection = v.clone();
	point_of_intersection.multiplyScalar(c);
	point_of_intersection.add(p1);
	point_of_intersection.sub(collision_data.point);
	point_of_intersection.applyMatrix3(collision_data.matrix);
	if ( point_of_intersection.x >= 0 && point_of_intersection.x <= 1 && point_of_intersection.y >= 0 && point_of_intersection.y <= 1) {
		return true;
	}
	return false;
}

function check_collisions(player) {
	for (var neighbor of player.cell.neighbors) {
		for (var collision_data of neighbor.trails) {
			if ( collision_data.id != player.player_id && player.getEdges().some( (edge) => intersects(collision_data, edge)) ) {
				console.log(player.player_id, "hit", collision_data.id);
				players.get(collision_data.id).score++;
				destroy_player(player.player_id, "collision", true);
				return true;
			}
		}
	}
}

/* INITIALIZATION */

function get_neighbors(x, y, z) {
	var neighbors = new Set();
	for (var i of [-1, 0, 1]) {
		for (var j of [-1, 0, 1]) {
			for (var k of [-1, 0, 1]) {
				if (x + i >= 0 && x + i < n && y + j >= 0 && y + j < n && z + k >= 0 && z + k < n) {
					neighbors.add(cells[x + i][y + j][z + k]);
				}
			}
		}
	}
	return neighbors;
}

function initialize_cells() {
	cells = new Array(n);
	for (var i = 0; i < n; i++) {
		cells[i] = new Array(n);
		for (let j = 0; j < n; j++) {
			cells[i][j] = new Array(n);
			for (let k = 0; k < n; k++) {
				cells[i][j][k] = { planes: new Set(), trails: new Set() };
			}
		}
	}
	for (var i = 0; i < n; i++) {
		for (let j = 0; j < n; j++) {
			for (let k = 0; k < n; k++) {
				cells[i][j][k].neighbors = get_neighbors(i, j, k);
			}
		}
	}
}
initialize_cells();

/* MISC. */

function get_cell(v) {
	var x =  Math.floor(v.x / cell_dim);
	var y = Math.floor(v.y / cell_dim);
	var z = Math.floor(v.z / cell_dim);
	return cells[x][y][z];
}

function alter_bounds(player) {
	var x = player.position.x;
	var y = player.position.y;
	var z = player.position.z;
	player.oob_flag = false;
	if (x < buffer) {
		player.oob_flag = true;
		x = 2 * outer_radius - buffer - epsilon;
	}
	else if (x > 2 * outer_radius - buffer) {
		player.oob_flag = true;
		x = buffer + epsilon;
	}
	if (y < buffer) {
		player.oob_flag = true;
		y = 2 * outer_radius - buffer - epsilon;
	}
	else if (y > 2 * outer_radius - buffer) {
		player.oob_flag = true;
		y = buffer + epsilon;
	}
	if (z < buffer) {
		player.oob_flag = true;
		z = 2 * outer_radius - buffer - epsilon;
	}
	else if (z > 2 * outer_radius - buffer) {
		player.oob_flag = true;
		z = buffer + epsilon;
	}
	if (player.oob_flag) {
		player.position.set(x, y, z);
		player.updateMatrixWorld();
	}
}

function count_down() {
	if (seconds_left == 0) {
		reset_all();
	}
	else {
		io.emit("time", seconds_left);
		seconds_left--;
	}
}

function reset_all() {
	game_in_progress = false;
	io.emit("game_over");
	clearInterval(update_id);
	clearInterval(timer);
	for ( var player of players.values() ) {
		io.emit("result", {user_name: player.user_name, score: player.score} );
	}
	io.emit("results_sent", players.size);
	players = new Map();
	initialize_cells();
	seconds_left = initial_seconds;
}
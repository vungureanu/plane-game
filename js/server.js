const exp = require("express");
const app = exp();
const http = require("http").createServer(app);
const io = require("socket.io")(http);
const THREE = require("three");

/* CONSTANTS */

const outer_radius = 200;
const center = new THREE.Vector3(outer_radius, outer_radius, outer_radius);
const inner_radius = 100; // Radius of obstacle in middle of arena
const side_length = 15; // Upper bound on distance from center of plane to any point on plane
const radius_buffer_squared = Math.pow(inner_radius + side_length, 2);
const radius_squared = Math.pow(inner_radius, 2);
const refresh_time = 100; // Milliseconds between successive refreshes
const trail_length = 100; // Maximum number of rectangles in plane's trail
const normal_speed = 0.5;
const fast_speed = 3;
const turn_speed = 0.25;
const cell_dim = 50; // Side length of cubes into which space is partitioned for collision detection purposes
const initial_gas = 300;
const buffer = 20; // Determines player's new location after stepping out of bounds
var cells; // Will hold array of cells (constant once intialized)
const n = 2 * Math.ceil(outer_radius / cell_dim); // Number of cubes per side
const epsilon = 1; // Small constant for transporting plane to opposite end of arena
const initial_seconds = 30; // Amount of time per round
const wing_length = 10;
const respawn_time = 1000; // Interval between destruction of plane and respawning
const accepted_characters = /^[0-9 + a-z + A-Z + _]+$/;
const gas_replenish = 2;
const gas_deplete = -3;
//var available_ids = new ID_Heap(10); // Contains unused IDs

var players = new Map(); // Holds information about each player
var seconds_left = initial_seconds;
var update_id; // Identifies timer responsible for periodically updating scene
var timer_id; // Identifies timer responsible for keeping track of time remaining in round 
var game_in_progress = false;
var cur_id = 1;
var socket_to_plane_id = new Map();

http.listen(3000, function() {
	console.log('listening on *:3000');
});

app.use(exp.static(__dirname + "/.."));

function Player(user_name, socket) {
	THREE.Object3D.call(this);
	draw_plane.call(this);
	this.score = 0;
	if ( typeof user_name == "string" && user_name.match(accepted_characters) ) {
		this.user_name = user_name.substring(0, 16);
	}
	else {
		this.user_name = "guest";
	}
	var player_names = Array.from(players.values()).map(p => p.user_name);
	if ( player_names.includes(this.user_name) ) {
		suffix = 1;
		while ( player_names.includes(this.user_name + suffix) ) suffix++;
		this.user_name += suffix;
	}
	this.socket = socket;
	this.x_frac = 0;
	this.y_frac = 0; // Horizontal mouse position
	this.click = false; // Whether mouse is depressed
	this.roll = "None";
	this.seq = 1;
	deploy_player(this);
}

Player.prototype = Object.create(THREE.Object3D.prototype);
Player.prototype.constructor = Player;
Player.prototype.getEdges = function() {
	// Returns an array of edges for the purpose of collision-checking
	var edges = [];
	edges.push( {p1: this.left_guide.coords, p2: this.right_guide.old_coords} );
	edges.push( {p1: this.right_guide.coords, p2: this.left_guide.old_coords} );
	edges.push( {p1: this.top_guide.coords, p2: this.bottom_guide.old_coords} );
	edges.push( {p1: this.bottom_guide.coords, p2: this.top_guide.old_coords} );
	return edges;
}

Player.prototype.get_data = function(send_trail) {
	// Send data about player, possibly including full trail
	return {
		id: this.plane_id,
		pos: this.getWorldPosition(),
		rot: this.rotation,
		gas: this.gas,
		user_name: this.user_name,
		click: this.click,
		trail: send_trail ? this.trail : [],
		seq: this.seq
	};
}

function update_world() {
	for ( var player of players.values() ) {
		if (player.deployed) {
			update_location(player);
			io.emit( "update", player.get_data(false) );
			check_collisions(player);
		}
	}
}

/* SOCKET */

function destroy_player(socket, reason, redeploy) {
	var id = socket_to_plane_id[socket];
	// Render the player's plane inactive
	if ( players.has(id) ) {
		let player = players.get(id);
		console.log("Destroying player", id, "because of", reason);
		player.deployed = false;
		io.emit("destroy", {id: id, reason: reason});
		for (var collision_data of player.collision_data) {
			collision_data.cell.trails.delete(collision_data);
		}
		player.cell.planes.delete(id);
		players.delete(id);
		if (redeploy) {
			console.log("Redeploying", id);
			setTimeout(deploy_player.bind(null, player), respawn_time);
		}
	}
	else {
		// Should never happen
		console.log("Attempt to delete non-existent player:", id);
	}
}

function deploy_player(player) {
	player.plane_id = cur_id;
	players.set(cur_id, player);
	socket_to_plane_id[player.socket] = cur_id;
	cur_id++;
	player.deployed = true;
	player.gas = initial_gas;
	player.collision_data = [];
	player.trail = []; // An array whose elements are pairs of coordinates indicating the location of the plane's wing-tips
	var r = outer_radius - buffer;
	var theta = Math.random() * 2 * Math.PI;
	var phi = Math.random() * Math.PI;
	player.position.set(
		r * Math.sin(theta) * Math.cos(phi),
		r * Math.sin(theta) * Math.sin(phi),
		r * Math.cos(theta)
	);
	player.position.addScalar(outer_radius);
	player.lookAt(center);
	player.rotateX(Math.PI/2); // Face the moon
	player.updateMatrixWorld();
	player.left_guide.coords = player.left_guide.getWorldPosition();
	player.right_guide.coords = player.right_guide.getWorldPosition();
	player.cell = get_cell(player.position);
	player.cell.planes.add(player.plane_id);
	for (var i = 0; i < trail_length - 1; i++) { // Pump in some filler data to ensure that these arrays are of the right length
		player.trail.push( {left: player.left_guide.coords, right: player.right_guide.coords} );
		let collision_datum = {cell: player.cell};
		player.collision_data.push(collision_datum);
		player.collision_data.push(collision_datum);
	}
	player.trail.push( {left: player.left_guide.coords, right: player.right_guide.coords} );
	var msg = player.get_data(false);
	player.socket.broadcast.emit("add", msg);
	player.socket.emit("id", msg);
}

function update_location(player) {
	if (!player.deployed) {
		return false;
	}
	player.seq++;
	var speed = (player.click && player.gas > 0) ? fast_speed : normal_speed;
	player.rotateZ(-player.x_frac * speed * turn_speed);
	player.rotateX(-player.y_frac * speed * turn_speed);
	if (player.roll != "None") {
		player.rotateY( player.roll == "CW" ? turn_speed : -turn_speed);
	}
	player.translateY(speed);
	player.updateMatrixWorld();
	alter_bounds(player);
	for (guide of player.guides) {
		guide.old_coords = guide.coords;
		guide.coords = guide.getWorldPosition();
	}
	player.cell.planes.delete(player.plane_id);
	player.cell = get_cell(player.position);
	player.cell.planes.add(player.plane_id);
	player.gas += (speed == normal_speed) ? gas_replenish : gas_deplete;
	player.gas = Math.min(initial_gas, player.gas);
	update_trail(player);
	if (player.position.distanceToSquared(center) <= radius_buffer_squared) {
		if ( crashed(player.left_guide) || crashed(player.right_guide) || crashed(player.top_guide) || crashed(player.bottom_guide) ) {
			destroy_player(player.socket, "crash", true);
		}
	}
}

io.on("connect", function(socket) {
	console.log("New connection from", socket.handshake.address);
	socket.on("start", function(user_name) {
		if (!game_in_progress) { // Start new round
			update_id = setInterval(update_world, refresh_time);
			timer_id = setInterval(count_down, 1000);
			players = new Map();
			initialize_cells();
			seconds_left = initial_seconds;
			game_in_progress = true;
			cur_id = 1;
		}
		socket.emit( "config", get_configuration_data() );
		for ( var player of players.values() ) {
			socket.emit( "add", player.get_data(true) );
		}
		var new_player = new Player(user_name, socket);
		socket.emit( "scores", get_scores() );
	});
	socket.on("status", function(status) { // Status update from player
		if ( players.has(status.id) ) {
			let player = players.get(status.id);
			player.x_frac = (typeof status.x_frac) == "number" ? status.x_frac : 0;
			player.y_frac = (typeof status.y_frac) == "number" ? status.y_frac : 0;
			player.click = (typeof status.click) == "boolean" ? status.click : false;
			player.roll = (typeof status.roll) == "string" ? status.roll : "None";
		}
		else if (status.id != -1) {
			console.log("Data received from unknown player:", status.id);
		}
	});
	socket.on( "disconnect", () => destroy_player(socket, "disconnection", false) );
});

/* GRAPHICS */

function draw_plane() {
	this.left_guide = new THREE.Object3D();
	this.right_guide = new THREE.Object3D();
	this.top_guide = new THREE.Object3D();
	this.bottom_guide = new THREE.Object3D();
	this.guides = [this.left_guide, this.right_guide, this.top_guide, this.bottom_guide];
	for (guide of this.guides) {
		this.add(guide);
		guide.old_coords = guide.getWorldPosition();
		guide.coords = guide.old_coords;
	}
	this.left_guide.position.set(-7, 2, 0);
	this.right_guide.position.set(7, 2, 0);
	this.top_guide.position.set(0, 5.5, 1);
	this.bottom_guide.position.set(0, -6, 0.5);
}

function update_trail(player) {
	// 
	player.collision_data[0].cell.trails.delete(player.collision_data[0]);
	player.collision_data[1].cell.trails.delete(player.collision_data[1]);
	player.collision_data.shift();
	player.collision_data.shift();
	var collision_data = get_collision_data(player.left_guide.old_coords, player.left_guide.coords, player.right_guide.old_coords, player.plane_id);
	collision_data.cell.trails.add(collision_data);
	player.collision_data.push(collision_data);
	var collision_data = get_collision_data(player.right_guide.coords, player.left_guide.coords, player.right_guide.old_coords, player.plane_id);
	collision_data.cell.trails.add(collision_data);
	player.collision_data.push(collision_data);
	player.trail.push( {left: player.left_guide.coords, right: player.right_guide.coords} );
	player.trail.shift();
}

function get_collision_data(p1, p2, p3, plane_id) {
	var v1 = minus(p2, p1);
	var v2 = minus(p3, p1);
	var v3 = new THREE.Vector3().crossVectors(v1, v2);
	v3.normalize();
	var matrix = new THREE.Matrix3(); // Represents linear transformation mapping trail paralellogram (with origin at p1) to unit square
	matrix.set( 
		v1.x, v2.x, v3.x,
		v1.y, v2.y, v3.y,
		v1.z, v2.z, v3.z
	);
	try {
		matrix = matrix.getInverse(matrix, true);
	}
	catch(e) {
		// This should never happen
		console.log("Matrix not invertible:", matrix);
	}
	var center = p1.clone();
	center.addScaledVector(v1, 0.5);
	center.addScaledVector(v2, 0.5);
	var cell = get_cell(center);
	var collision_data = {
		matrix: matrix,
		normal: v3,
		point: p1,
		id: plane_id,
		cell: cell
	};
	return collision_data;
}

/* INTERSECTION DETECTION */

/* Checks whether the line segment from "p1" to "p2" intersects the planar section given by "matrix".
The idea is that "matrix" represents a linear transformation which maps its associated trail rectangle to the unit
square ([0, 1] x [0, 1] x {0}).  We need only check whether a point lying within the plane containing the trail
rectangle is mapped to the unit square. */

function intersects(collision_data, edge) {
	// Find intersection between "edge" and trail paralellogram represented by "collision_data".
	var v = minus(edge.p2, edge.p1);
	var dp = collision_data.normal.dot(v);
	if (dp == 0) { // Line and plane are parallel.
		return false;
	}
	var c = minus(collision_data.point, edge.p1).dot(collision_data.normal) / dp;
	if (c < 0 || c > 1) {
		return false;
	}
	// Intersection occurs on line segment connecting "point" to "point" + "v".
	point_of_intersection = minus(v.multiplyScalar(c), collision_data.point);
	point_of_intersection.add(edge.p1);
	point_of_intersection.applyMatrix3(collision_data.matrix);
	if ( point_of_intersection.x >= 0 && point_of_intersection.x <= 1 && point_of_intersection.y >= 0 && point_of_intersection.y <= 1 && point_of_intersection.x + point_of_intersection.y <= 1) {
		return true;
	}
	return false;
}

function check_collisions(player) {
	for (var neighbor of player.cell.neighbors) {
		for (var collision_data of neighbor.trails) {
			if ( collision_data.id != player.plane_id && player.getEdges().some( (edge) => intersects(collision_data, edge)) ) {
				console.log(player.plane_id, "hit", collision_data.id);
				players.get(collision_data.id).score++;
				io.emit("score", collision_data.id);
				destroy_player(player.socket, "collision", true);
				return true;
			}
		}
	}
}

/* INITIALIZATION */

function get_neighbors(x, y, z) {
	// Return a set consisting of the cell with given coordinates and its neighbors
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
	// Each cell can access its occupants (planes and plane trails), and has a set containing itself and its neighbors
	cells = new Array(n);
	for (var i = 0; i < n; i++) {
		cells[i] = new Array(n);
		for (let j = 0; j < n; j++) {
			cells[i][j] = new Array(n);
			for (let k = 0; k < n; k++) {
				cells[i][j][k] = { planes: new Set(), trails: new Set(), coords: [i, j, k] };
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
	// Returns cell containing vector "v"
	var x = Math.floor(v.x / cell_dim);
	var y = Math.floor(v.y / cell_dim);
	var z = Math.floor(v.z / cell_dim);
	return cells[x][y][z];
}

function alter_bounds(player) {
	var oob_flag = false;
	var coords = new Map( [["x", player.position.x], ["y", player.position.y], ["z", player.position.z]] );
	for ( var coord of coords.entries() ) {
		if (coord[1] < buffer) {
			oob_flag = true;
			coords.set(coord[0], 2 * outer_radius - buffer - epsilon);
			player.left_guide.coords[ coord[0] ] = 2 * outer_radius - buffer;
			player.right_guide.coords[ coord[0] ] = 2 * outer_radius - buffer;
		}
		else if (coord[1] > 2 * outer_radius - buffer) {
			oob_flag = true;
			coords.set(coord[0], buffer + epsilon);
			player.left_guide.coords[ coord[0] ] = buffer;
			player.right_guide.coords[ coord[0] ] = buffer;
		}
	}
	if (oob_flag) {
		player.position.set( coords.get("x"), coords.get("y"), coords.get("z") );
		player.updateMatrixWorld();
	}
}

function count_down() {
	if (seconds_left == 0) { // Clear data associated with present round and show results
		game_in_progress = false;
		clearInterval(update_id);
		clearInterval(timer_id);
		results = Array.from(players.values()).map(player => ({user_name: player.user_name, score: player.score}) );
		io.emit("result", results);
	}
	else {
		io.emit("time", seconds_left);
		seconds_left--;
	}
}

function minus(v1, v2) {
	return new THREE.Vector3(v1.x - v2.x, v1.y - v2.y, v1.z - v2.z);
}

function get_configuration_data() {
	return {
		initial_gas: initial_gas,
		trail_length: trail_length,
		inner_radius: inner_radius,
		outer_radius: outer_radius,
		seconds_left: seconds_left
	};
}

function get_scores() {
	return Array.from(players.values()).map( player => ({plane_id: player.plane_id, score: player.score}) );
}

function crashed(object) {
	return object.getWorldPosition().distanceToSquared(center) < radius_squared;
}
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
const normal_speed = 1.5;
const fast_speed = 5;
const turn_speed = 0.25;
const cell_dim = 50; // Side length of cubes into which space is partitioned for collision detection purposes
const initial_gas = 300;
const buffer = 20; // Determines plane's new location after stepping out of bounds
var cells; // Will hold array of cells (constant once intialized)
const n = 2 * Math.ceil(outer_radius / cell_dim); // Number of cubes per side
const epsilon = 1; // Small constant for transporting plane to opposite end of arena
const initial_seconds = 30; // Amount of time per round
const wing_length = 10;
const respawn_time = 1000; // Interval between destruction of plane and respawning
const accepted_characters = /^[0-9 + a-z + A-Z + _]+$/;
const gas_replenish = 2;
const gas_deplete = -3;
const invulnerable_period = 1500; // Period of time after deployment during which plane is invulnerable

var planes = new Map(); // Holds information about each plane
var players = new Set(); // Holds information about each player
var seconds_left = initial_seconds;
var update_id; // Identifies timer responsible for periodically updating scene
var timer_id; // Identifies timer responsible for keeping track of time remaining in round 
var game_in_progress = false;
var cur_id = 1;

http.listen(3000, function() {
	console.log('listening on *:3000');
});

app.use(exp.static(__dirname + "/.."));

function Plane(player) {
	THREE.Object3D.call(this);
	this.player = player;
	this.draw_plane();
	this.x_frac = 0;
	this.y_frac = 0; // Horizontal mouse position
	this.click = false; // Whether mouse is depressed
	this.roll = "None";
	this.seq = 1;
	this.invulnerable = true;
	setTimeout(() => this.invulnerable = false, invulnerable_period);
	this.deploy_plane();
}

Plane.prototype = Object.create(THREE.Object3D.prototype);
Plane.prototype.constructor = Plane;
Plane.prototype.getEdges = function() {
	// Returns an array of edges for the purpose of collision-checking
	var edges = [];
	edges.push( {p1: this.left_guide.coords, p2: this.right_guide.old_coords} );
	edges.push( {p1: this.right_guide.coords, p2: this.left_guide.old_coords} );
	edges.push( {p1: this.top_guide.coords, p2: this.bottom_guide.old_coords} );
	edges.push( {p1: this.bottom_guide.coords, p2: this.top_guide.old_coords} );
	return edges;
}

Plane.prototype.get_data = function(send_trail) {
	// Send data about plane, possibly including full trail
	return {
		id: this.plane_id,
		pos: this.getWorldPosition(),
		rot: this.rotation,
		gas: this.gas,
		user_name: this.player.user_name,
		click: this.click,
		trail: send_trail ? this.trail : [],
		seq: this.seq
	};
}

Plane.prototype.update_trail = function() {
	// Adds collision data of two most recent trail triangles
	for (var third_coord of [this.left_guide.old_coords, this.right_guide.coords]) {
		// The two trail triangles share two vertices; the third vertex therefore determines one of the triangles
		var oldest_datum = this.collision_data.shift();
		oldest_datum.cell.trails.delete(oldest_datum);
		var collision_datum = get_collision_datum(third_coord, this.left_guide.coords, this.right_guide.old_coords, this);
		collision_datum.cell.trails.add(collision_datum);
		this.collision_data.push(collision_datum);
	}
	this.trail.push( {left: this.left_guide.coords, right: this.right_guide.coords} );
	this.trail.shift();
}

Plane.prototype.alter_bounds = function() {
	var oob_flag = false;
	var coords = new Map( [["x", this.position.x], ["y", this.position.y], ["z", this.position.z]] );
	for ( var coord of coords.entries() ) {
		if (coord[1] < buffer) {
			oob_flag = true;
			coords.set(coord[0], 2 * outer_radius - buffer - epsilon);
			this.left_guide.coords[ coord[0] ] = 2 * outer_radius - epsilon;
			this.left_guide.coords[ coord[0] ] = 2 * outer_radius - epsilon;
		}
		else if (coord[1] > 2 * outer_radius - buffer) {
			oob_flag = true;
			coords.set(coord[0], buffer + epsilon);
			this.left_guide.coords[ coord[0] ] = epsilon;
			this.left_guide.coords[ coord[0] ] = epsilon;
		}
	}
	if (oob_flag) {
		this.position.set( coords.get("x"), coords.get("y"), coords.get("z") );
		this.updateMatrixWorld();
	}
}

Plane.prototype.update_location = function() {
	if (!this.deployed) return false;
	this.seq++;
	var speed = (this.click && this.gas > 0) ? fast_speed : normal_speed;
	this.rotateZ(-this.x_frac * speed * turn_speed);
	this.rotateX(-this.y_frac * speed * turn_speed);
	if (this.roll != "None") {
		this.rotateY( this.roll == "CW" ? turn_speed : -turn_speed);
	}
	this.translateY(speed);
	this.updateMatrixWorld();
	this.alter_bounds(); // If plane has left arena, place it on opposite side of arena
	for (guide of this.guides) {
		guide.old_coords = guide.coords;
		guide.coords = guide.getWorldPosition();
	}
	this.cell.planes.delete(this);
	this.cell = get_cell(this.position);
	this.cell.planes.add(this);
	this.gas += (speed == normal_speed) ? gas_replenish : gas_deplete;
	this.gas = Math.min(initial_gas, this.gas);
	this.update_trail();
	if (this.position.distanceToSquared(center) <= radius_buffer_squared) {
		if ( crashed(this.left_guide) || crashed(this.right_guide) || crashed(this.top_guide) || crashed(this.bottom_guide) ) {
			this.destroy_plane("crash");
		}
	}
}

Plane.prototype.check_collisions = function() {
	if (this.invulnerable) return false;
	for (var neighbor of this.cell.neighbors) { // Plane may have collided with object in adjacent cell
		for (var collision_data of neighbor.trails) {
			if ( collision_data.plane != this && this.getEdges().some( edge => intersects(collision_data, edge)) ) {
				console.log("Plane", this.plane_id, "hit plane", collision_data.plane.plane_id);
				collision_data.plane.player.score++;
				io.emit("score", collision_data.plane.player.user_name);
				this.destroy_plane("collision");
				return true;
			}
		}
	}
}

Plane.prototype.destroy_plane = function(reason, redeploy = true) {
	if ( planes.has(this.plane_id) ) {
		console.log("Destroying plane", this.plane_id, "because of", reason);
		this.deployed = false;
		io.emit("destroy", {id: this.plane_id, user_name: this.player.user_name, reason: reason});
		for (var collision_datum of this.collision_data) {
			collision_datum.cell.trails.delete(collision_datum); // Simply returns false if "collision_datum" is not present
		}
		this.cell.planes.delete(this);
		planes.delete(this.plane_id);
		if (redeploy) setTimeout(redeploy_plane.bind(this), respawn_time);
	}
	else {
		// Should never happen
		console.log("Attempt to delete non-existent plane", this.plane_id, "because of", reason);
	}
}

Plane.prototype.draw_plane = function() {
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

function redeploy_plane() {
	if (game_in_progress) this.deploy_plane();
}

Plane.prototype.deploy_plane = function() {
	console.log("Deploying plane", cur_id);
	this.plane_id = cur_id;
	planes.set(cur_id, this);
	cur_id++;
	this.deployed = true;
	this.gas = initial_gas;
	this.collision_data = []; // An array whose ith element contains data about colliding into the 
	this.trail = []; // An array whose elements are pairs of coordinates indicating the location of the plane's wing-tips
	var r = outer_radius - buffer;
	var theta = Math.random() * 2 * Math.PI;
	var phi = Math.random() * Math.PI;
	this.position.set(
		r * Math.sin(theta) * Math.cos(phi),
		r * Math.sin(theta) * Math.sin(phi),
		r * Math.cos(theta)
	);
	this.position.addScalar(outer_radius);
	this.lookAt(center);
	this.rotateX(Math.PI/2); // Face the moon
	this.updateMatrixWorld();
	this.left_guide.coords = this.left_guide.getWorldPosition();
	this.right_guide.coords = this.right_guide.getWorldPosition();
	this.cell = get_cell(this.position);
	this.cell.planes.add(this);
	this.trail.push( {left: this.left_guide.coords, right: this.right_guide.coords} ); // First trail line has no associated "collision_data"
	for (var i = 0; i < trail_length - 1; i++) { // Pump in some filler data to ensure arrays are of the right length
		collision_datum = {cell: this.cell, point: null}; // Necessary, since "update_trail" requires that all collision data reference a cell
		this.collision_data.push(collision_datum);
		this.collision_data.push(collision_datum);
		this.trail.push( {left: this.left_guide.coords, right: this.right_guide.coords} );
	}
	var msg = this.get_data(false);
	this.player.socket.broadcast.emit("add", msg);
	this.player.socket.emit("id", msg);
}

function send_collision_data() { // Used for debugging
	var centers = [];
	for (player of players) {
		if (player.plane == null) continue;
		for (collision_datum of player.plane.collision_data) {
			if (collision_datum.point != null) {
				centers.push(collision_datum.point);
			}
		}
	}
	io.emit("collision_data", centers);
}

function Player(socket) {
	this.socket = socket;
	this.score = 0;
	this.active = false; // Has not yet joined current round
	// The next two properties will be set when game starts
	this.user_name = "unknown";
	this.plane = null;
}

Player.prototype.set_user_name = function(user_name) {
	if ( typeof user_name == "string" && user_name.match(accepted_characters) ) {
		this.user_name = user_name.substring(0, 16);
	}
	else {
		this.user_name = "guest";
	}
	var player_names = Array.from(players).filter(p => p.active).map(p => p.user_name);
	if ( player_names.includes(this.user_name) ) {
		suffix = 1;
		while ( player_names.includes(this.user_name + suffix) ) suffix++;
		this.user_name += suffix;
	}
}

function disconnect() { // "this" is meant to refer to a "Player"
	if (game_in_progress) this.plane.destroy_plane("disconnection", redeploy = false);
	planes.delete(this.plane_id);
	players.delete(this);
}

function update_world() {
	for ( var plane of planes.values() ) {
		if (plane.deployed) {
			plane.update_location();
			io.emit( "update", plane.get_data(false) );
			plane.check_collisions();
		}
	}
}

/* CLIENT-SERVER COMMUNICATION */

io.on("connect", function(socket) {
	console.log("New connection from", socket.handshake.address);
	var player = new Player(socket);
	players.add(player);
	socket.on("start", function(user_name) {
		if (!game_in_progress) {
			start_new_round();
		}
		player.set_user_name(user_name);
		player.active = true;
		socket.emit( "config", get_configuration_data() );
		for ( var plane of planes.values() ) {
			if (plane.deployed) socket.emit( "add", plane.get_data(true) );
		}
		player.plane = new Plane(player);
		socket.emit( "scores", get_scores() );
	});
	socket.on("status", function(status) { // Status update from plane
		if ( planes.has(status.id) ) {
			let plane = planes.get(status.id);
			plane.x_frac = (typeof status.x_frac) == "number" ? status.x_frac : 0;
			plane.y_frac = (typeof status.y_frac) == "number" ? status.y_frac : 0;
			plane.click = (typeof status.click) == "boolean" ? status.click : false;
			plane.roll = (typeof status.roll) == "string" ? status.roll : "None";
		}
		else if (status.id != -1) {
			console.log("Data received from unknown plane:", status.id);
		}
	});
	socket.on( "disconnect", disconnect.bind(player) );
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

function get_collision_datum(p1, p2, p3, plane) {
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
	var collision_data = {
		matrix: matrix,
		normal: v3,
		point: center, // p1,
		plane: plane,
		cell: get_cell(center)
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

function start_new_round() {
	console.log("Starting new round.");
	update_id = setInterval(update_world, refresh_time);
	timer_id = setInterval(count_down, 1000);
	planes = new Map();
	for (player of players) {
		player.active = false;
		player.score = 0;
	}
	cur_id = 1;
	seconds_left = initial_seconds;
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
	game_in_progress = true;
}

/* MISC. */

function get_cell(v) {
	// Returns cell containing vector "v"
	var x = Math.floor(v.x / cell_dim);
	var y = Math.floor(v.y / cell_dim);
	var z = Math.floor(v.z / cell_dim);
	return cells[x][y][z];
}

function count_down() {
	if (seconds_left <= 0) { // Clear data associated with present round and show results
		game_in_progress = false;
		clearInterval(update_id);
		clearInterval(timer_id);
		results = Array.from(players).filter(p => p.active).map(p => ({user_name: p.user_name, score: p.score}) );
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
		seconds_left: seconds_left,
		buffer: buffer
	};
}

function get_scores() {
	return Array.from(players).filter(p => p.active).map( p => ({user_name: p.user_name, score: p.score}) );
}

function crashed(object) {
	return object.getWorldPosition().distanceToSquared(center) < radius_squared;
}
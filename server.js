var app = require("express")();
var http = require("http").createServer(app);
var io = require("socket.io")(http);
var THREE = require("three");
var players = new Map();
const outer_radius = 150;
const center = new THREE.Vector3(outer_radius, outer_radius, outer_radius);
const inner_radius = 50;
const REFRESH_TIME = 100; // Milliseconds between successive refreshes
const trail_length = 100; // Maximum number of rectangles in plane's trail
const NORMAL_SPEED = 0.5;
const FAST_SPEED = 3;
const TURN_SPEED = 0.25;
var cell_dim = 50; // Side length of cubes into which space is partitioned for collision detection purposes
const initial_gas = 1000;
const buffer = 20; // Determines player's new location after stepping out of bounds
var cur_id = 0;
var cells;
var n = 2 * Math.ceil(outer_radius/cell_dim); // Number of cubes per side

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

function Player(player_id, socket) {
	var r = Math.random() * (outer_radius - inner_radius - 2 * buffer) + inner_radius;
	var theta = Math.random() * Math.PI;
	var phi = Math.random() * Math.PI - Math.PI / 2;
	this.oob_flag = false;
	this.socket = socket;
	this.plane = draw_plane();
	this.x_frac = 0;
	this.y_frac = 0; // Horizontal mouse position
	this.click = false, // Whether mouse is depressed
	this.player_id = player_id; // ID assigned to player
	this.gas = initial_gas;
	this.collision_data = [];
	/* Change-of-basis matrix from {v1, v2, v3} to {e1, e2, e3}, where v1 and v2 are the sides of a trail square,
	and v3 is their cross product.  Also includes the center point of the trail rectangle and a normal to the
	trail rectangle. */
	this.trail = []; // Coordinates of trail edges
	this.plane.position.set(
		r * Math.sin(theta) * Math.cos(phi),
		r * Math.sin(theta) * Math.sin(phi),
		r * Math.cos(theta)
	);
	this.plane.position.addScalar(outer_radius);
	this.plane.updateMatrixWorld();
	var lr_coords = {
		left : this.plane.left_guide.getWorldPosition(),
		right : this.plane.right_guide.getWorldPosition()
	};
	this.cell = get_cell(this.plane.position);
	this.cell.planes.add(cur_id);
	for (var i = 0; i < trail_length-1; i++) {
		this.trail.push(lr_coords);
		this.collision_data.push( {normal: new THREE.Vector3(0, 0, 0), cell: this.cell} );
	}
	this.trail.push(lr_coords);
}

function update_world() {
	for ( var player of players.values() ) {
		update_location(player);
		send_location(player);
		check_collisions(player);
	}
}

setInterval(update_world, REFRESH_TIME);

/* SOCKET */

function destroy_player(id, reason) {
	if ( players.has(id) ) {
		let player = players.get(id);
		console.log("Destroying", id, "because of", reason);
		io.emit("destroy", {id : id, reason : reason} );
		for (var collision_data of player.collision_data) {
			collision_data.cell.trails.delete(collision_data);
		}
		player.cell.planes.delete(id);
		players.delete(id);
	}
	else {
		console.log("Attempt to delete non-existent player:", id);
	}
}

function update_location(player) {
	var speed = player.click ? FAST_SPEED : NORMAL_SPEED;
	player.plane.rotateY(-player.x_frac * speed * TURN_SPEED);
	player.plane.rotateX(player.y_frac * speed * TURN_SPEED);
	player.plane.translateZ(speed);
	player.plane.updateMatrixWorld();
	alter_bounds(player);
	player.cell.planes.delete(player.player_id);
	player.cell = get_cell(player.plane.position);
	player.cell.planes.add(player.player_id);
	player.gas -= speed;
	if (player.plane.position.distanceToSquared(center) <= inner_radius * inner_radius) {
		player.gas = initial_gas;
	}
	if (player.gas <= 0) {
		destroy_player(player.player_id, "gas");
	}
	update_trail(player);
}

function send_location(player) {
	io.emit("update", {
		id: player.player_id, 
		pos: player.plane.getWorldPosition(),
		rot: player.plane.rotation,
		gas: player.gas
	});
}

io.on("connection", function(socket) {
	var player_id = cur_id;
	cur_id++;
	console.log("New connection from", socket.handshake.address);
	socket.on("start", function() {
		socket.emit("config", {
			initial_gas: initial_gas,
			trail_length: trail_length,
			inner_radius: inner_radius,
			outer_radius: outer_radius
		});
		var new_player = new Player(player_id, socket);
		var msg = {
			id: new_player.player_id,
			pos: new_player.plane.position,
			rot: new_player.plane.rotation,
			gas: initial_gas,
			trail: new_player.trail
		};
		socket.emit("id", msg);
		for (var player of players.values()) {
			player.socket.emit("add", msg);
			socket.emit("add", {
				id: player.player_id,
				pos: player.plane.getWorldPosition(),
				rot: player.plane.rotation,
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
		else {
			console.log("Data received from unknown player:", status);
		}
	});
	socket.on("disconnect", () => destroy_player(player_id, "disconnection"));
});

/* GRAPHICS */

function draw_plane() {
	var plane = new THREE.Object3D();
	plane.left_guide = new THREE.Object3D();
	plane.right_guide = new THREE.Object3D();
	plane.left_guide.position.set(5, 0, 0);
	plane.right_guide.position.set(-5, 0, 0);
	plane.add(plane.left_guide);
	plane.add(plane.right_guide);
	return plane;
}

function update_trail(player) {
	player.collision_data[0].cell.trails.delete(player.collision_data[0]);
	player.collision_data.shift();
	var new_left = player.plane.left_guide.getWorldPosition();
	var new_right = player.plane.right_guide.getWorldPosition();
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
	var center = new_left.clone();
	center.addScaledVector(v1, 0.5);
	center.addScaledVector(v2, 0.5);
	var cell = get_cell(center);
	var collision_data = {
		matrix: matrix,
		normal: v3,
		point: center,
		id: player.player_id,
		cell: cell
	};
	cell.trails.add(collision_data);
	player.collision_data.push(collision_data);
	player.trail.push( {left: new_left, right: new_right, cell: cell} );
	player.trail.shift();
}

/* INTERSECTION DETECTION */

/* Checks whether the line segment from "p1" to "p2" intersects the planar section given by "matrix".
The idea is that "matrix" represents a linear transformation which maps its associated trail rectangle to the unit
square ([0, 1] x [0, 1] x {0}).  We need only check whether a point lying within the plane containing the trail
rectangle is mapped to the unit square. */

function intersects(collision_data, p1, p2) {
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
			if ( collision_data.id != player.player_id && intersects(collision_data, player.plane.left_guide.getWorldPosition(), player.plane.right_guide.getWorldPosition()) ) {
				console.log(player.player_id, "hit", collision_data.id);
				destroy_player(player.player_id, "collision");
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
	for (let i = 0; i < n; i++) {
		cells[i] = new Array(n);
		for (let j = 0; j < n; j++) {
			cells[i][j] = new Array(n);
			for (let k = 0; k < n; k++) {
				cells[i][j][k] = { planes: new Set(), trails: new Set() };
			}
		}
	}
	for (let i = 0; i < n; i++) {
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
	var x = player.plane.position.x;
	var y = player.plane.position.y;
	var z = player.plane.position.z;
	player.oob_flag = false;
	if (x < buffer) {
		player.oob_flag = true;
		x = 2 * (outer_radius - buffer);
	}
	else if (x > 2 * outer_radius - buffer) {
		player.oob_flag = true;
		x = 2 * buffer;
	}
	if (y < buffer) {
		player.oob_flag = true;
		y = 2 * (outer_radius - buffer);
	}
	else if (y > 2 * outer_radius - buffer) {
		player.oob_flag = true;
		y = 2 * buffer;
	}
	if (z < buffer) {
		player.oob_flag = true;
		z = 2 * (outer_radius - buffer);
	}
	else if (z > 2 * outer_radius - buffer) {
		player.oob_flag = true;
		z = 2 * buffer;
	}
	if (player.oob_flag) {
		player.plane.position.set(x, y, z);
		player.plane.updateMatrixWorld();
	}
}
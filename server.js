var app = require("express")();
var http = require("http").createServer(app);
var io = require("socket.io")(http);
var THREE = require("three");
var players = {};
const OUTER_RADIUS = 200;
const INNER_RADIUS = 50;
const REFRESH_TIME = 100; // Milliseconds between successive refreshes
const TRAIL_LENGTH = 100; // Maximum number of rectangles in plane's trail
const NORMAL_SPEED = 0.5;
const FAST_SPEED = 1;
var cur_id = 0;
var destroy_queue = [];

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

function create_new_player() {
	var r = Math.random() * (OUTER_RADIUS-INNER_RADIUS) + INNER_RADIUS;
	var theta = Math.random() * Math.PI;
	var phi = Math.random() * Math.PI - Math.PI / 2;
	var new_player = {
		plane : draw_plane(), // Plane
		x_frac : 0, // Horizontal mouse position
		y_frac : 0, // Vertical mouse position
		turn : 0, // -1 indicates that the "a" key has been pressed, 1 that the "d" key has been pressed, and 0 that neither has been pressed. 
		click : false, // Whether mouse is depressed
		id : cur_id, // ID assigned to player
		plane_container : new THREE.Group(), // Group containing only "plane".
		collision_data : [], // Change-of-basis matrix from {v1, v2, v3} to {e1, e2, e3}, where v1 and v2 are the sides of a trail square, and v3 is their cross product.
		trail : [] // Coordinates of trail edges
	};
	new_player.plane_container.add(new_player.plane);
	new_player.plane_container.position.set(
		r * Math.sin(theta) * Math.cos(phi),
		r * Math.sin(theta) * Math.sin(phi),
		r * Math.cos(theta)
	);
	new_player.plane_container.updateMatrixWorld();
	new_player.plane.updateMatrixWorld();
	var lr_coords = {
		left : new_player.plane.getObjectByName("left guide").getWorldPosition(),
		right : new_player.plane.getObjectByName("right guide").getWorldPosition()
	}
	for (var i = 0; i < TRAIL_LENGTH; i++) {
		new_player.trail.push(lr_coords);
	}
	return new_player;
}

function update_world() {
	for ( var id in players ) {
		update_location(players[id]);
		send_location(players[id]);
		clear_destroyed_players();
	}
}

setInterval(update_world, REFRESH_TIME);

/* SOCKET */

function clear_destroyed_players() {
	destroy_queue.forEach( function (player) {
		io.emit("destroy", player.id);
		delete players[player.id];
	});
	destroy_queue = [];
}

function update_location( player ) {
	var speed = player.click ? FAST_SPEED : NORMAL_SPEED;
	player.plane_container.rotateY(-player.x_frac * speed);
	player.plane_container.rotateX(player.y_frac * speed);
	player.plane.rotateZ(player.turn * speed);
	player.plane_container.translateZ(speed);
	update_trail(player);
}

function send_location( player ) {
	io.emit("update", {
		id : player.id, 
		pos : player.plane_container.getWorldPosition(),
		outer_rot : player.plane_container.rotation,
		inner_rot : player.plane.rotation,
		trail : player.trail[TRAIL_LENGTH-1]
	});
}

io.on("connection", function(socket) {
	var new_player = create_new_player();
	var msg = {
		id : new_player.id,
		pos : new_player.plane_container.position,
		outer_rot : new_player.plane_container.rotation,
		inner_rot : new_player.plane.rotation,
		trail : new_player.trail
	};
	socket.emit("id", msg);
	socket.broadcast.emit("add", msg);
	for (var id in players) {
		socket.emit("add", {
			id : players[id].id,
			pos : players[id].plane_container.getWorldPosition(),
			outer_rot : players[id].plane_container.rotation,
			inner_rot : players[id].plane.rotation,
			trail : players[id].trail
		});
	}
	socket.on("status", function(status) {
		if ( status.id in players ) {
			players[status.id].x_frac = status.x_frac;
			players[status.id].y_frac = status.y_frac;
			players[status.id].turn = status.turn;
			players[status.id].click = status.click;
		}
		else {
			console.log("Data received from unknown player:", status);
		}
	});
	players[cur_id] = new_player;
	cur_id += 1;
});

/* GRAPHICS */

function draw_plane() {
	var plane = new THREE.Group();
	var geometry = new THREE.SphereGeometry( 1, 32, 32 );
	var material = new THREE.MeshBasicMaterial( {color: 0xff0000} );
	var left_guide = new THREE.Mesh( geometry, material );
	left_guide.name = "left guide";
	var right_guide = new THREE.Mesh( geometry, material );
	right_guide.name = "right guide";
	left_guide.position.set( 5, 0, 0 );
	right_guide.position.set( -5, 0, 0 );
	plane.add(left_guide);
	plane.add(right_guide);
	return plane;
}

function update_trail( player ) {
	var new_left = player.plane.getObjectByName("left guide").getWorldPosition();
	var new_right = player.plane.getObjectByName("right guide").getWorldPosition();
	var old_left = player.trail[TRAIL_LENGTH-1].left;
	var old_right = player.trail[TRAIL_LENGTH-1].right;
	var v1 = new THREE.Vector3().copy( new_right );
	v1.sub(	new_left );
	var v2 = new THREE.Vector3().copy( new_right );
	v2.sub( old_right );
	var v3 = new THREE.Vector3(0, 0, 0);
	v3.crossVectors(v1, v2); // If v1 and v2 are not parallel, then {v1, v2, v3} is a basis of R^3.
	var inv_mat = new THREE.Matrix3();
	inv_mat.set( 
		new_right.x - new_left.x, new_right.x - old_right.x, v3.x,
		new_right.y - new_left.y, new_right.y - old_right.y, v3.y,
		new_right.z - new_left.z, new_right.z - old_right.z, v3.z
	);
	try {
		inv_mat = inv_mat.getInverse(inv_mat, true);
	}
	catch(e) {
		console.log("Matrix not invertible:", old_right, new_left, new_right);
	}
	var collision_data = {
		matrix : inv_mat,
		normal : v3,
		point : old_left
	}
	if (player.collision_data.length == TRAIL_LENGTH-1) {
		player.collision_data.shift();
	}
	player.collision_data.push(collision_data);
	player.trail.push( {left : new_left, right : new_right} );
	player.trail.shift();
	for (var collision_data of player.collision_data) {
		if ( intersects(collision_data, new_left, new_right) ) {
			destroy_queue.push(player);
			return 0; // Make sure player can only be added to "destroy_queue" once
		}
	}
}

/* INTERSECTION DETECTION */


/* Checks whether the line segment from "p1" to "p2" intersects the plane section given by "matrix".
The idea is that "matrix" represents a linear transformation which maps the trail rectangle to the unit square
([0, 1] x [0, 1] x {0}).  We need only check whether a point lying within the plane containing the trail
rectangle is mapped to the unit square. */

function intersects( collision_data, p1, p2 ) {
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
	//console.log(point_of_intersection, point_of_intersection.dot(collision_data.normal));
	point_of_intersection.sub(collision_data.point);
	point_of_intersection.applyMatrix3(collision_data.matrix);
	//console.log(point_of_intersection);
	if ( point_of_intersection.x >= 0 && point_of_intersection.x <= 1 && point_of_intersection.y >= 0 && point_of_intersection.y <= 1) {
		return true;
	}
	return false;
}

var m = new THREE.Matrix3();
m.set(
	1, 1, -1,
	1, 1, 1,
	1, -2, 0
);
m = m.getInverse(m);
collision_data = {
	matrix : m,
	normal : new THREE.Vector3( -1, 1, 0 ),
	point : new THREE.Vector3(1, 2, 3)
}
var p1 = new THREE.Vector3(-2, 7, 1);
var p2 = new THREE.Vector3(0, 1, 3);
intersects(collision_data, p1, p2 );

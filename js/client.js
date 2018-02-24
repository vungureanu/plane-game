const scene = new THREE.Scene();
const renderer = new THREE.WebGLRenderer();
renderer.setSize( window.innerWidth, window.innerHeight );
document.body.appendChild( renderer.domElement );
var socket = io();
const trail_material = new THREE.MeshBasicMaterial({
		color: 0x0000ff,
		side : THREE.DoubleSide,
		transparent : true,
		opacity: 0.5
	});
const TRAIL_LENGTH = 100;
const SPEED = 0.1;
const SEND_INTERVAL = 100; // Milliseconds between successive send operations
const OUTER_RADIUS = 500;
const INNER_RADIUS = 50;
// Distance of mouse away from center, as fraction of the canvas's width or height
var x_frac = 0;
var y_frac = 0;
var players = {}; // State (spatial coordinates and orientation) of all other players
var contrails = []; // Player's own contrails
var turn = 0;
var click = false;
var own_id;
var send_data_id;

/* GRAPHICS */

function draw_plane( coords ) {
	var plane = new THREE.Group();
	plane.name = "plane";
	var geometry = new THREE.BoxGeometry( 1, 1, 20 );
	var material = new THREE.MeshBasicMaterial( { color: 0x0000ff } );
	var cube = new THREE.Mesh( geometry, material );
	var geometry = new THREE.SphereGeometry( 2, 32, 32 );
	var material = new THREE.MeshBasicMaterial( {color: 0xff00ff} );
	var sphere = new THREE.Mesh( geometry, material );
	var geometry = new THREE.BoxGeometry( 10, 1, 1 );
	var material = new THREE.MeshBasicMaterial( { color: 0x0000ff } );
	var cross = new THREE.Mesh( geometry, material );
	var geometry = new THREE.SphereGeometry( 1, 32, 32 );
	var material = new THREE.MeshBasicMaterial( {color: 0xff0000} );
	var left_guide = new THREE.Mesh( geometry, material );
	left_guide.name = "left guide";
	var right_guide = new THREE.Mesh( geometry, material );
	right_guide.name = "right guide";
	sphere.position.set( 0, 0, 10 );
	cross.position.set( 0, 0, 0 );
	left_guide.position.set( 5, 0, 0 );
	right_guide.position.set( -5, 0, 0 );
	plane.add(cube);
	plane.add(sphere);
	plane.add(cross);
	plane.add(left_guide);
	plane.add(right_guide);
	return plane;
}

var geometry = new THREE.SphereGeometry( OUTER_RADIUS, 32, 32 );
var material = new THREE.MeshBasicMaterial( {color: 0x3399ff, side : THREE.BackSide} );
var sphere = new THREE.Mesh( geometry, material );
scene.add(sphere);
var geometry = new THREE.SphereGeometry( INNER_RADIUS, 32, 32 );
var material = new THREE.MeshBasicMaterial( {color: 0x00ff00} );
var sphere = new THREE.Mesh( geometry, material );
scene.add(sphere);

// Adds a rectangle to a player's trail, removing oldest rectangle if necessary.
function add_trail( player, new_coords ) {
	var triangleGeometry = new THREE.Geometry();
	triangleGeometry.vertices[0] = player.old_coords.left;
	triangleGeometry.vertices[1] = player.old_coords.right;
	triangleGeometry.vertices[2] = new_coords.left;
	triangleGeometry.vertices[3] = new_coords.right;
	triangleGeometry.faces.push( new THREE.Face3(0, 1, 2) );
	triangleGeometry.faces.push( new THREE.Face3(1, 2, 3) );
	var square = new THREE.Mesh( triangleGeometry, trail_material );
	if (player.trail[player.trail_index] != undefined) {
		scene.remove(player.trail[player.trail_index]);
	}
	player.trail[player.trail_index] = square;
	player.trail_index = (player.trail_index + 1) % TRAIL_LENGTH;
	scene.add( square );
	player.old_coords = new_coords;
}

var plane_and_camera = new THREE.Group();
var own_plane = draw_plane();
var camera = new THREE.PerspectiveCamera( 75, window.innerWidth/window.innerHeight, 0.1, 1000 );
plane_and_camera.add(own_plane);
plane_and_camera.add(camera);
camera.position.set(0, 0, -25);
camera.lookAt(0, 0, 0);
scene.add(plane_and_camera);

window.addEventListener('keypress', function(e) {
	if (e.keyCode == 65 || e.keyCode == 97) {
		turn = -1;
	}
	if (e.keyCode == 68 || e.keyCode == 100) {
		turn = 1;
	}
});
window.addEventListener('keyup', function(e) {
	if (e.keyCode == 65 || e.keyCode == 97 || e.keyCode == 68 || e.keyCode == 100) {
		turn = 0;
	}
});
window.addEventListener('mousemove', function(e) {
	x_frac = (e.clientX - window.innerWidth / 2) / window.innerWidth;
	y_frac = (e.clientY - window.innerHeight / 2) / window.innerHeight;
});
window.addEventListener('resize', function() {
	renderer.setSize( window.innerWidth, window.innerHeight );
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
});
window.addEventListener('mousedown', function() {
	click = true;
});
window.addEventListener('mouseup', function() {
	click = false;
});

// CLIENT-SERVER COMMUNICATION

function send_data() {
	socket.emit("status", {
		id : own_id,
		x_frac : x_frac,
		y_frac : y_frac,
		turn : turn,
		click : click
	});
}

send_data_id = setInterval(send_data, SEND_INTERVAL);

socket.on("update", function(status) {
	var outer_rot = new THREE.Euler(status.outer_rot._x, status.outer_rot._y, status.outer_rot._z, status.outer_rot._order);
	var inner_rot = new THREE.Euler(status.inner_rot._x, status.inner_rot._y, status.inner_rot._z, status.inner_rot._order);
	var player = players[status.id];
	player.plane_container.setRotationFromEuler(outer_rot);
	player.plane.setRotationFromEuler(inner_rot);
	player.plane_container.position.set(status.pos.x, status.pos.y, status.pos.z);
	var new_coords = {
		left : new THREE.Vector3( status.trail.left.x, status.trail.left.y, status.trail.left.z ),
		right : new THREE.Vector3( status.trail.right.x, status.trail.right.y, status.trail.right.z )
	};
	add_trail(player, new_coords);
	renderer.render(scene, camera);
});

socket.on("id", function(status) {
	plane_and_camera.position.set(status.pos.x, status.pos.y, status.pos.z);
	var outer_rot = new THREE.Euler(status.outer_rot._x, status.outer_rot._y, status.outer_rot._z, status.outer_rot._order);
	var inner_rot = new THREE.Euler(status.inner_rot._x, status.inner_rot._y, status.inner_rot._z, status.inner_rot._order);
	plane_and_camera.setRotationFromEuler(outer_rot);
	own_plane.setRotationFromEuler(inner_rot);
	plane_and_camera.updateMatrixWorld();
	own_plane.updateMatrixWorld();
	var left = own_plane.getObjectByName("left guide").getWorldPosition();
	var right = own_plane.getObjectByName("right guide").getWorldPosition();
	players[status.id] = {
		plane_container : plane_and_camera,
		plane : own_plane,
		trail : [ {left : left, right : right} ],
		trail_index : 0,
		old_coords : {left : left, right : right}
	};
	own_id = status.id;
});

socket.on("add", function(status) {
	var plane = draw_plane();
	var plane_container = new THREE.Group();
	plane_container.add(plane);
	plane_container.position.set(status.pos.x, status.pos.y, status.pos.z);
	var outer_rot = new THREE.Euler(status.outer_rot._x, status.outer_rot._y, status.outer_rot._z, status.outer_rot._order);
	var inner_rot = new THREE.Euler(status.inner_rot._x, status.inner_rot._y, status.inner_rot._z, status.inner_rot._order);
	plane_container.setRotationFromEuler(outer_rot);
	plane.setRotationFromEuler(inner_rot);
	var left = plane.getObjectByName("left guide").getWorldPosition();
	var right = plane.getObjectByName("right guide").getWorldPosition();
	players[status.id] = {
		plane_container : plane_container,
		plane : plane,
		trail : [ {left : left, right : right} ],
		trail_index : 0,
		old_coords : { left : left, right : right }
	};
	for ( var i = 1; i <= status.trail_index; i++ ) {
		var new_coords = {
			left : new THREE.Vector3( status.trail[i].left.x, status.trail[i].left.y, status.trail[i].left.z ),
			right : new THREE.Vector3( status.trail[i].right.x, status.trail[i].right.y, status.trail[i].right.z )
		};
		add_trail(players[status.id], new_coords );
	}
	scene.add(plane_container);
});

socket.on("destroy", function(id) {
	clearInterval(send_data_id);
});
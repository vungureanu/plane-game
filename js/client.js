const scene = new THREE.Scene();
const renderer = new THREE.WebGLRenderer( {canvas : document.getElementById("main_screen")} );
var frac = 19 / 20;
var game_height = window.innerHeight * frac;
renderer.setSize( window.innerWidth, game_height );
const gas_bar = document.getElementById("gasBar");
var socket = io();
const trail_material = new THREE.MeshBasicMaterial({
		color: 0x0000ff,
		side : THREE.DoubleSide,
		transparent : true,
		opacity: 0.5
});
const own_material = new THREE.MeshBasicMaterial({
		color: 0x00ff00,
		side : THREE.DoubleSide,
		transparent : true,
		opacity: 0.5
});
const TRAIL_LENGTH = 100;
const SPEED = 0.1;
const SEND_INTERVAL = 100; // Milliseconds between successive send operations
const OUTER_RADIUS = 500;
const INNER_RADIUS = 50;
const initial_gas = 1000;
// Distance of mouse away from center, as fraction of the canvas's width or height
var x_frac = 0;
var y_frac = 0;
var players = {}; // State (spatial coordinates and orientation) of all other players
var click = false; // Whether mouse is depressed.
var own_id;
var send_data_id; // Identifies process sending data to server.
var own_plane;
var camera = new THREE.PerspectiveCamera( 75, window.innerWidth/game_height, 0.1, 1000 );

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
	left_guide.name = "left";
	var right_guide = new THREE.Mesh( geometry, material );
	right_guide.name = "right";
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

// Adds a rectangle to a player's trail, removing oldest rectangle if necessary.
function add_trail( player, new_coords ) {
	var triangleGeometry = new THREE.Geometry();
	triangleGeometry.vertices[0] = player.old_coords.left;
	triangleGeometry.vertices[1] = player.old_coords.right;
	triangleGeometry.vertices[2] = new_coords.left;
	triangleGeometry.vertices[3] = new_coords.right;
	triangleGeometry.faces.push( new THREE.Face3(0, 1, 2) );
	triangleGeometry.faces.push( new THREE.Face3(1, 2, 3) );
	if (player.id == own_id) {
		var square = new THREE.Mesh( triangleGeometry, own_material );
	}
	else {
		var square = new THREE.Mesh( triangleGeometry, trail_material );
	}
	player.trail.push(square);
	scene.add( square );
	player.old_coords = new_coords;
}

function shorten_trail( player ) {
	scene.remove(player.trail[0]);
	player.trail.shift();
}

/* CLIENT-SERVER COMMUNICATION */

function send_data() {
	socket.emit("status", {
		id : own_id,
		x_frac : x_frac,
		y_frac : y_frac,
		click : click
	});
}

send_data_id = setInterval(send_data, SEND_INTERVAL);

socket.on("update", function(status) {
	console.log("OK", status);
	var rot = new THREE.Euler(status.rot._x, status.rot._y, status.rot._z, status.rot._order);
	var player = players[status.id];
	player.plane.setRotationFromEuler(rot);
	player.plane.position.set(status.pos.x, status.pos.y, status.pos.z);
	var new_coords = {
		left : new THREE.Vector3( status.trail.left.x, status.trail.left.y, status.trail.left.z ),
		right : new THREE.Vector3( status.trail.right.x, status.trail.right.y, status.trail.right.z )
	};
	add_trail(player, new_coords);
	shorten_trail(player);
	update_gas(status.gas);
	renderer.render(scene, camera);
});

socket.on("id", function(status) {
	own_id = status.id;
	own_plane = new Plane(status.pos, status.rot, true);
	var old_coords = own_plane.getCoords();
	players[status.id] = {
		id : status.id,
		plane : own_plane,
		trail : [],
		old_coords : old_coords
	};
	for ( var i = 0; i < TRAIL_LENGTH; i++ ) {
		players[own_id].trail.push( old_coords );
	}
});

socket.on("add", function(status) {
	var plane = new Plane(status.pos, status.rot, false);
	players[status.id] = {
		id : status.id,
		plane : plane,
		trail : [],
		old_coords : plane.getCoords()
	};
	for ( var i = 0; i < TRAIL_LENGTH; i++ ) {
		var new_coords = {
			left : new THREE.Vector3( status.trail[i].left.x, status.trail[i].left.y, status.trail[i].left.z ),
			right : new THREE.Vector3( status.trail[i].right.x, status.trail[i].right.y, status.trail[i].right.z )
		};
		add_trail(players[status.id], new_coords );
	}
});

socket.on("destroy", function(id) {
	if (id in players) {
		for ( square of players[id].trail ) {
			scene.remove(square);
		}
		scene.remove(players[id].plane);
		delete players[id];
	}
	if (id == own_id) {
		alert("Ouch!");
		clearInterval(send_data_id);
	}
});

/* CONTROLS */

window.addEventListener('mousemove', function(e) {
	x_frac = (e.clientX - window.innerWidth / 2) / window.innerWidth;
	y_frac = (e.clientY - game_height / 2) / game_height;
});
window.addEventListener('resize', function() {
	game_height = window.innerHeight * frac;
	renderer.setSize( window.innerWidth, game_height );
	camera.aspect = window.innerWidth / game_height;
	gas_bar.style.top = game_height;
	camera.updateProjectionMatrix();
});
window.addEventListener('mousedown', function() {
	click = true;
});
window.addEventListener('mouseup', function() {
	click = false;
});

/* GRAPHICS */

function Plane(pos, rot, add_camera) {
	THREE.Object3D.call(this);
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
	left_guide.name = "left";
	var right_guide = new THREE.Mesh( geometry, material );
	right_guide.name = "right";
	sphere.position.set( 0, 0, 10 );
	cross.position.set( 0, 0, 0 );
	left_guide.position.set( 5, 0, 0 );
	right_guide.position.set( -5, 0, 0 );
	this.add(cube);
	this.add(sphere);
	this.add(cross);
	this.add(left_guide);
	this.add(right_guide);
	if (add_camera == true) {
		this.add(camera);
		camera.position.set(0, 0, -25);
		camera.lookAt(0, 0, 0);
	}
	this.position.set(pos.x, pos.y, pos.z);
	this.setRotationFromEuler( new THREE.Euler(rot._x, rot._y, rot._z, rot._order) );
	this.updateMatrixWorld();
	scene.add(this);
}

Plane.prototype = new THREE.Object3D();
Plane.prototype.constructor = Plane;
Plane.prototype.getCoords = function() {
	var left = this.getObjectByName("left").getWorldPosition();
	var right = this.getObjectByName("right").getWorldPosition();
	return { left : left, right : right };
}

function draw_background() {
	var material = new THREE.MeshBasicMaterial( {color: 0xffffff} );
	for (var i = 0; i < 100; i++) {
		let radius = Math.random() * 3 + 1;
		let geometry = new THREE.SphereGeometry(radius, 32, 32);
		let r = Math.random() * 1000 + 300;
		let theta = Math.random() * 2 * Math.PI;
		let phi = Math.random() * Math.PI;
		let star = new THREE.Mesh( geometry, material );
		star.position.set(
			r * Math.sin(theta) * Math.cos(phi),
			r * Math.sin(theta) * Math.sin(phi),
			r * Math.cos(theta)
		);
		scene.add(star);
	}
}
draw_background();

function update_gas(gas) {
	gas_context.clearRect(0, 0, gas_bar.width, gas_bar.height);
	gas_context.fillStyle = "rgb(0, 255, 0)";
	gas_context.fillRect(0, 0, gas_bar.width * gas / initial_gas, gas_bar.height);
}

function draw_sun() {
	var material = new THREE.MeshBasicMaterial( {
		color: 0xffff11,
		transparent: true,
		opacity: 0.5,
		side: THREE.DoubleSide
	});
	var geometry = new THREE.SphereGeometry(INNER_RADIUS, 32, 32);
	var sun = new THREE.Mesh(geometry, material);
	sun.renderOrder = 1;
	scene.add(sun);
}
draw_sun();

/* GAS BAR */



gas_bar.style.top = game_height;
gas_bar.width = window.innerWidth;
gas_bar.height = window.innerHeight - game_height;
var gas_context = gas_bar.getContext("2d");
gas_context.fillStyle = "rgb(0, 0, 0)";
gas_context.fillRect(0, 0, gas_bar.width/2, gas_bar.height);

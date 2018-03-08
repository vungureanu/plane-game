const scene = new THREE.Scene();
const game_screen = document.getElementById("game_screen");
const renderer = new THREE.WebGLRenderer( {canvas: game_screen} );
const frac = 19 / 20; // Proportion of screen width taken up by main game
var seconds_left;
var game_height = window.innerHeight * frac;
renderer.setSize( window.innerWidth, game_height );
const gas_bar = document.getElementById("gasBar");
const gas_context = gas_bar.getContext("2d");
const timer = document.getElementById("timer");
game_screen.style.visibility = "hidden";
gas_bar.style.visibility = "hidden";
var first_round = true;
var socket = io();
const num_stars = 100;
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
const bounds_front = {
	color: 0xaa2727,
	transparent: true,
	opacity: 0,
	side: THREE.FrontSide
};
const bounds_back = {
	color: 0xaa2727,
	transparent: true,
	opacity: 0,
	side: THREE.BackSide
};
var trail_length;
const SEND_INTERVAL = 100; // Milliseconds between successive send operations
const star_offset = 300;
const field_of_view = 75;
var outer_radius;
var inner_radius;
var initial_gas;
// Distance of mouse away from center, as fraction of the canvas's width or height
var x_frac = 0;
var y_frac = 0;
var players = new Map(); // State (spatial coordinates and orientation) of all other players
var click = false; // Whether mouse is depressed.
var own_id = -1;
var send_data_id; // Identifies process sending data to server.
var own_player;
var sides = {}; // Outer boundaries of space
var camera = new THREE.PerspectiveCamera(field_of_view, window.innerWidth/game_height, 0.1, 1000);
var screen_status = "start";
var buffer = 20;
const vis_dist = 30;
var results = [];
var total_results;
const vertical_spacing = 0.75;
const start_message = "\nUse the mouse to maneuver; click to accelerate.\nTry to ensnare other players in your trail, but avoid running into other players' trails.\nIf you venture beyond the bounds of the arena, you will reappear on the opposite side.\n\n\nPress SPACE to start.\n";
const fade_rate = 20;
const fade_increment = 0.1;

/* GRAPHICS */

const main_screen = document.getElementById("main_screen");
main_screen.width = window.innerWidth;
main_screen.height = window.innerHeight;
main_screen.style.visibility = "visible";
const screen_context = main_screen.getContext("2d");

function prepare_screen() {
	main_screen.style.visibility = "visible";
	main_screen.height = window.innerHeight;
	main_screen.width = window.innerWidth;
	screen_context.clearRect(0, 0, main_screen.width, main_screen.height);
	screen_context.fillStyle = "rgb(0, 0, 0)";
	screen_context.fillRect(0, 0, main_screen.width, main_screen.height);
	screen_context.fillStyle = "rgb(255, 255, 255)";
}

prepare_screen();
format_text(start_message);

function format_text(msg) {
	prepare_screen();
	var lines = msg.split('\n');
	var line_height = Math.min( main_screen.height / lines.length, 32 );
	var total_height = line_height * lines.length;
	var offset = (main_screen.height - total_height) / 2; 
	screen_context.font = Math.floor(vertical_spacing * line_height) + "px serif";
	screen_context.textBaseline = "middle";
	screen_context.textAlign = "center";
	screen_context.fillStyle = "rgb(255, 255, 255)";
	for (var i = 0; i < lines.length; i++) {
		screen_context.fillText(lines[i], main_screen.width / 2, offset + line_height * i);
	}
}

function display_results() {
	prepare_screen();
	var offset = 50;
	var line_height = Math.min(Math.ceil(main_screen.height / total_results), 24);
	screen_context.font = line_height + "px serif";
	for (var result of results) {
		screen_context.fillText(result.name + ": " + result.score, main_screen.width / 2, offset);
		offset += line_height;
	}
}

function clear_players() {
	timer.innerHTML = "";
	for ( var player of players.values() ) {
		destroy_player(player);
	}
	players = new Map();
	screen_status = "start";
	game_screen.style.visibility = "hidden";
	gas_bar.style.visibility = "hidden";
}

function draw_quadrilateral(p0, p1, p2, p3) {
	var geometry = new THREE.Geometry();
	geometry.vertices[0] = p0;
	geometry.vertices[1] = p1;
	geometry.vertices[2] = p2;
	geometry.vertices[3] = p3;
	geometry.faces.push( new THREE.Face3(0, 1, 2) );
	geometry.faces.push( new THREE.Face3(0, 2, 3) );
	return geometry;
}

// Adds a rectangle to a player's trail, removing oldest rectangle if necessary.
function add_trail(player, new_coords) {
	if (player.old_coords.left.distanceTo(new_coords.left) > outer_radius / 2) {
		player.old_coords = new_coords;
	}
	var triangleGeometry = new THREE.Geometry();
	triangleGeometry.vertices[0] = player.old_coords.left;
	triangleGeometry.vertices[1] = player.old_coords.right;
	triangleGeometry.vertices[2] = new_coords.left;
	triangleGeometry.vertices[3] = new_coords.right;
	triangleGeometry.faces.push( new THREE.Face3(0, 1, 2) );
	triangleGeometry.faces.push( new THREE.Face3(1, 2, 3) );
	if (player.player_id == own_id) {
		var square = new THREE.Mesh(triangleGeometry, own_material);
	}
	else {
		var square = new THREE.Mesh(triangleGeometry, trail_material);
	}
	player.trail.push(square);
	scene.add(square);
	player.old_coords = new_coords;
}

function shorten_trail(player) {
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

socket.on("update", function(status) {
	if ( players.has(status.id) ) {
		var player = players.get(status.id);
		var rot = new THREE.Euler(status.rot._x, status.rot._y, status.rot._z, status.rot._order);
		player.setRotationFromEuler(rot);
		player.position.set(status.pos.x, status.pos.y, status.pos.z);
		if (status.id == own_id) {
			update_bounds();
		}
		var new_coords = player.getCoords();
		add_trail(player, new_coords);
		shorten_trail(player);
		update_gas(status.gas);
		renderer.render(scene, camera);
	}
});

socket.on("id", function(status) {
	if (own_id != -1) {
		own_player.remove(camera);
	}
	own_id = status.id;
	own_player = new Player(status.id, status.pos, status.rot, true);
	renderer.render(scene, camera);
	if (screen_status == "waiting") {
		screen_status = "game";
		main_screen.style.visibility = "hidden";
		game_screen.style.visibility = "visible";
		gas_bar.style.visibility = "visible";
		results = [];
		total_results = -1;
	}
	for (var i = 0; i < trail_length; i++) {
		own_player.trail.push(own_player.old_coords);
	}
	send_data_id = setInterval(send_data, SEND_INTERVAL);
});

socket.on("add", function(status) {
	var player = new Player(status.id, status.pos, status.rot, false);
	for ( var i = 0; i < trail_length; i++ ) {
		var new_coords = {
			left : new THREE.Vector3( status.trail[i].left.x, status.trail[i].left.y, status.trail[i].left.z ),
			right : new THREE.Vector3( status.trail[i].right.x, status.trail[i].right.y, status.trail[i].right.z )
		};
		add_trail(player, new_coords);
	}
});

socket.on("destroy", function(status) {
	if ( players.has(status.id) ) {
		//destroy_player( players.get(status.id) );
		explode( players.get(status.id) );
		//add_explosion( players.get(status.id).getWorldPosition() );
		//players.delete(status.id);
	}
	if (status.id == own_id) {
		own_id = -1;
		if (status.reason == "gas") {
			gas = 0;
			update_gas();
		}
	}
	renderer.render(scene, camera);
});

socket.on("game_over", function() {
	clearInterval(send_data_id);
	clear_players();
});

socket.on("config", function(config) {
	initial_gas = config.initial_gas;
	trail_length = config.trail_length;
	inner_radius = config.inner_radius;
	outer_radius = config.outer_radius;
	seconds_left = config.seconds_left;
	if (first_round) {
		draw_sun();
		draw_background();
		draw_bounds();
		first_round = false;
	}
	update_gas();
	draw_time();
});

socket.on("time", function(sl) {
	seconds_left = sl;
	draw_time();
});

socket.on("result", function(status) {
	results.push( {name: status.id, score: status.score} );
	if (results.length == total_results) {
		results.sort( (a, b) => a.score < b.score ? -1 : 1 );
		display_results();
	}
});

socket.on("results_sent", function(length) {
	total_results = length;
	if (results.length == total_results) {
		results.sort( (a, b) => a.score < b.score ? -1 : 1 );
		display_results();
	}
});

/* CONTROLS */

window.addEventListener("mousemove", function(e) {
	x_frac = (e.clientX - window.innerWidth / 2) / window.innerWidth;
	y_frac = (e.clientY - game_height / 2) / game_height;
});

window.addEventListener("resize", function() {
	game_height = window.innerHeight * frac;
	renderer.setSize(window.innerWidth, game_height);
	camera.aspect = window.innerWidth / game_height;
	camera.updateProjectionMatrix();
	update_gas();
	if (screen_status == "start") {
		format_text(start_message);
	}
});

window.addEventListener("mousedown", function() {
	click = true;
});

window.addEventListener("keypress", function(e) {
	if (e.key == ' ' && screen_status == "start") {
		screen_status = "waiting";
		socket.emit("start");
	}
});

window.addEventListener("mouseup", function() {
	click = false;
});

/* GRAPHICS */

function Player(player_id, pos, rot, add_camera) {
	THREE.Object3D.call(this);
	this.materials = [
		new THREE.MeshBasicMaterial( {color: 0x0000ff} ),
		new THREE.MeshBasicMaterial( {color: 0xff00ff} ),
		new THREE.MeshBasicMaterial( {color: 0x0000ff} ),
		new THREE.MeshBasicMaterial( {color: 0xff0000} )
	];
	var geometry = new THREE.BoxGeometry( 1, 1, 20 );
	var cube = new THREE.Mesh( geometry, this.materials[0] );
	var geometry = new THREE.SphereGeometry( 2, 32, 32 );
	var sphere = new THREE.Mesh( geometry, this.materials[1] );
	var geometry = new THREE.BoxGeometry( 10, 1, 1 );
	var cross = new THREE.Mesh( geometry, this.materials[2] );
	var geometry = new THREE.SphereGeometry( 1, 32, 32 );
	this.left_guide = new THREE.Mesh( geometry, this.materials[3] );
	this.right_guide = new THREE.Mesh( geometry, this.materials[3] );
	sphere.position.set( 0, 0, 10 );
	cross.position.set( 0, 0, 0 );
	this.left_guide.position.set( 5, 0, 0 );
	this.right_guide.position.set( -5, 0, 0 );
	this.add(cube);
	this.add(sphere);
	this.add(cross);
	this.add(this.left_guide);
	this.add(this.right_guide);
	if (add_camera == true) {
		this.add(camera);
		camera.position.set(0, 0, -25);
		camera.lookAt(0, 0, 0);
	}
	this.position.set(pos.x, pos.y, pos.z);
	this.setRotationFromEuler( new THREE.Euler(rot._x, rot._y, rot._z, rot._order) );
	this.updateMatrixWorld();
	scene.add(this);
	this.player_id = player_id;
	this.old_coords = { left: this.left_guide.getWorldPosition(), right: this.right_guide.getWorldPosition() };
	this.trail = [];
	this.destroy = false;
	this.fade_id = -1;
	players.set(player_id, this);
}

Player.prototype = new THREE.Object3D();
Player.prototype.constructor = Player;
Player.prototype.getCoords = function() {
	return { left: this.left_guide.getWorldPosition(), right: this.right_guide.getWorldPosition() };
}

function draw_background() {
	var material = new THREE.MeshBasicMaterial( {color: 0xffffff} );
	for (var i = 0; i < num_stars; i++) {
		let radius = Math.random() * 1 + 0.5;
		let geometry = new THREE.SphereGeometry(radius, 32, 32);
		let r = Math.random() * outer_radius + outer_radius + star_offset;
		let theta = Math.random() * 2 * Math.PI;
		let phi = Math.random() * Math.PI;
		let star = new THREE.Mesh( geometry, material );
		star.position.set(
			r * Math.sin(theta) * Math.cos(phi),
			r * Math.sin(theta) * Math.sin(phi),
			r * Math.cos(theta)
		);
		star.position.addScalar(outer_radius);
		scene.add(star);
	}
}

function update_gas(gas) {
	gas_bar.width = window.innerWidth;
	gas_bar.height = window.innerHeight - game_height;
	gas_bar.style.top = game_height;
	gas_context.clearRect(0, 0, gas_bar.width, gas_bar.height);
	gas_context.fillStyle = "rgb(0, 0, 0)";
	gas_context.fillRect(0, 0, gas_bar.width, gas_bar.height);
	var frac = gas / initial_gas;
	var red = Math.ceil( 255 * (1 - frac) );
	var green = Math.ceil(255 * frac);
	gas_context.fillStyle = "rgb(" + red + "," + green + "," + "0)";
	gas_context.fillRect(0, 0, gas_bar.width * frac, gas_bar.height);
}

function draw_sun() {
	var material = new THREE.MeshBasicMaterial({
		color: 0xffff11,
		transparent: true,
		opacity: 0.5,
		side: THREE.DoubleSide
	});
	var geometry = new THREE.SphereGeometry(inner_radius, 32, 32);
	var sun = new THREE.Mesh(geometry, material);
	sun.renderOrder = 1;
	sun.position.set(outer_radius, outer_radius, outer_radius);
	scene.add(sun);
}

function add_explosion(pos) {
	var geometry = new THREE.SphereGeometry(2, 32, 32);
	var material = new THREE.MeshBasicMaterial( {color: 0xff00ff} );
	var sphere = new THREE.Mesh(geometry, material);
	sphere.position.set(pos.x, pos.y, pos.z);
	scene.add(sphere);
}

function draw_bounds() {
	var l = 2 * outer_radius;
	var p0 = new THREE.Vector3(0, 0, 0);
	var p1 = new THREE.Vector3(0, 0, l);
	var p2 = new THREE.Vector3(0, l, l);
	var p3 = new THREE.Vector3(0, l, 0);
	var p4 = new THREE.Vector3(l, 0, 0);
	var p5 = new THREE.Vector3(l, 0, l);
	var p6 = new THREE.Vector3(l, l, l);
	var p7 = new THREE.Vector3(l, l, 0);
	var geometry0 = draw_quadrilateral(p0, p1, p2, p3);
	sides.x0 = new THREE.MeshBasicMaterial(bounds_back);
	scene.add( new THREE.Mesh(geometry0, sides.x0) );
	var geometry1 = draw_quadrilateral(p4, p5, p6, p7);
	sides.x1 = new THREE.MeshBasicMaterial(bounds_front);
	scene.add( new THREE.Mesh(geometry1, sides.x1) );
	var geometry2 = draw_quadrilateral(p0, p1, p5, p4);
	sides.y0 = new THREE.MeshBasicMaterial(bounds_front);
	scene.add( new THREE.Mesh(geometry2, sides.y0) );
	var geometry3 = draw_quadrilateral(p3, p2, p6, p7);
	sides.y1 = new THREE.MeshBasicMaterial(bounds_back);
	scene.add( new THREE.Mesh(geometry3, sides.y1) );
	var geometry4 = draw_quadrilateral(p0, p3, p7, p4); 
	sides.z0 = new THREE.MeshBasicMaterial(bounds_back);
	scene.add( new THREE.Mesh(geometry4, sides.z0) );
	var geometry5 = draw_quadrilateral(p1, p2, p6, p5);
	sides.z1 = new THREE.MeshBasicMaterial(bounds_front);
	scene.add( new THREE.Mesh(geometry5, sides.z1) );
}

function update_bounds() {
	var coords = own_player.getWorldPosition();
	for ( var dim of ["x", "y", "z"] ) {
		sides[dim + 0].opacity = coords[dim] < vis_dist + buffer ? 1 - (coords[dim] - buffer) / vis_dist : 0;
		sides[dim + 1].opacity = coords[dim] > 2 * outer_radius - buffer - vis_dist ? 1 - (2 * outer_radius - buffer - coords[dim]) / vis_dist : 0;
	}
}

function draw_time() {
	timer.style.left = window.innerWidth - 50;
	timer.style.top = 20;
	timer.innerHTML = Math.floor(seconds_left / 60) + ":" + (seconds_left < 10 ? "0" : "") + (seconds_left % 60);
}

/* MISC */

function destroy_player(player) {
	for (square of player.trail) {
		scene.remove(square);
	}
	scene.remove(player);
}

function explode(player) {
	for (square of player.trail) {
		scene.remove(square);
	}
	for (material of player.materials) {
		material.transparent = true;
	}
	player.fade_id = setInterval(fade_away, fade_rate, player);
}

function fade_away(player) {
	if (player.materials[0].opacity <= 0) {
		clearInterval(player.fade_id);
		scene.remove(player);
	}
	for (material of player.materials) {
		material.opacity -= fade_increment;
	}
	renderer.render(scene, camera);
}



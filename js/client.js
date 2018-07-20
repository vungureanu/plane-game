var scene = new THREE.Scene();
const game_screen = document.getElementById("game_screen");
const renderer = new THREE.WebGLRenderer( {canvas: game_screen, precision: "lowp"} );
const frac = 19 / 20; // Proportion of screen width taken up by main game
var seconds_left;
var game_height = window.innerHeight * frac;
renderer.setSize(window.innerWidth, game_height);
const gas_bar = document.getElementById("gasBar");
const gas_context = gas_bar.getContext("2d");
const timer = document.getElementById("timer");
const rank = document.getElementById("rank");
var socket = io();
const num_stars = 100;
const moon_texture = new THREE.TextureLoader().load("resources/moon.jpg");
var plane_template;
const slow_rotate = 0.3;
const fast_rotate = 0.6;
const camera_position = new THREE.Vector3(0, -1, 2);
const score_table = document.getElementById("score_table");
var score_table_body = document.getElementById("score_table_body");

const texture = new THREE.TextureLoader().load("resources/plane_data/BodyTexture.bmp");
const plane_material = new THREE.MeshBasicMaterial( {map: texture} );
var plane_geometry = new THREE.BufferGeometry();
var prop_geometry = new THREE.BufferGeometry();
const objLoader = new THREE.OBJLoader();
objLoader.setPath('resources/plane_data/');
objLoader.load('plane.obj', function(object) {
	geometry_array = object.children.map(child => child.geometry);
	plane_geometry = THREE.BufferGeometryUtils.mergeBufferGeometries(geometry_array);
});
objLoader.load('prop.obj', function(object) {
	prop_geometry = object.children[0].geometry;
});

const other_material = new THREE.MeshStandardMaterial({
		color: 0xff0000,
		side : THREE.DoubleSide,
});
const own_material = new THREE.MeshBasicMaterial({
		color: 0x00ff00,
		side : THREE.DoubleSide,
		transparent : true,
		opacity: 0.5
});
const bounds_front = {
	color: 0x3065c1,
	transparent: true,
	opacity: 0,
	side: THREE.FrontSide
};
const bounds_back = {
	color: 0x3065c1,
	transparent: true,
	opacity: 0,
	side: THREE.BackSide
};
var trail_length;
const send_interval = 100;
const star_offset = 300;
var num_trail_vertices;
const field_of_view = 75;
var outer_radius;
var inner_radius;
var initial_gas;
var x_frac;
var y_frac;
var roll;
var players = new Map();
var own_id = -1;
var send_data_id;
var render_id;
var own_player = { click: false, destroyed: false };
var sides = {};
var camera = new THREE.PerspectiveCamera(field_of_view, window.innerWidth/game_height, 0.1, 1000);
var screen_status = "start";
var buffer = 20;
const vis_dist = 30;
var results = [];
var total_results = -1;
const vertical_spacing = 0.75;
const enter_name = "\n#CONTRAILS\n\n\nEnter nickname: ";
const start_message = "\n\n\nUse the mouse to maneuver; click to accelerate.\nTry to ensnare other players in your trail, but avoid running into other players' trails.\nIf you venture beyond the bounds of the arena, you will reappear on the opposite side.\n\n\nPress ENTER to start.\n";
var user_name = "";
const fade_rate = 20;
const fade_increment = 0.05;
const accepted_characters = /[0-9 + a-z + A-Z + _]/;

/* GRAPHICS */

const main_screen = document.getElementById("main_screen");
main_screen.width = window.innerWidth;
main_screen.height = window.innerHeight;
const screen_context = main_screen.getContext("2d");

function prepare_screen() {
	main_screen.height = window.innerHeight;
	main_screen.width = window.innerWidth;
	screen_context.clearRect(0, 0, main_screen.width, main_screen.height);
	screen_context.fillStyle = "rgb(0, 0, 0)";
	screen_context.fillRect(0, 0, main_screen.width, main_screen.height);
	screen_context.fillStyle = "rgb(255, 255, 255)";
}

prepare_screen();
format_text(enter_name + user_name + start_message);

function format_text(msg) {
	prepare_screen();
	var lines = msg.split('\n');
	var length = lines.length + lines.reduce( (acc, cur) => acc + cur.charAt(0) == '#' ? 1 : 0, 0);
	var line_height = Math.min(main_screen.height / length, 32);
	var total_height = line_height * length;
	var offset = (main_screen.height - total_height) / 2; 
	screen_context.textBaseline = "middle";
	screen_context.textAlign = "center";
	screen_context.fillStyle = "rgb(255, 255, 255)";
	var i = 0;
	for (var line of lines) {
		if (line.charAt(0) == '#') {
			screen_context.font = Math.floor(vertical_spacing * line_height) * 2 + "px monospace";
			screen_context.fillText(line.substring(1), main_screen.width / 2, offset + line_height * i);
			i += 2;
		}
		else {
			screen_context.font = Math.floor(vertical_spacing * line_height) + "px monospace";
			screen_context.fillText(line, main_screen.width / 2, offset + line_height * i);
			i++;
		}
	}
}

function display_results(results) {
	prepare_screen();
	if (results.length == 0) { // Perhaps the player joined the game right at the end, and has received only the "results_sent" message 
		format_text(enter_name + user_name + start_message);
		return false;
	}
	var msg = "#LEADERBOARD\n\n\n"
	maximum_length = results.map(el => el.user_name.length).reduce( (prev, cur) => Math.max(prev, cur) );
	for (var result of results) {
		msg += result.user_name + " ".repeat(maximum_length - result.user_name.length + 3) + result.score + "\n";
	}
	msg += "\n\n\nPress ENTER to continue"
	format_text(msg);
	results = [];
	total_results = -1;
}

function draw_quadrilateral(vertex_array, player = false) {
	// Consecutive vertices in "vertex_array", including first and last vertices, should be adjacent
	if (player) {
		var trail_array = player.trail_geometry.attributes.position.array;
		var normal_array = player.trail_geometry.attributes.normal.array;
		var index = player.trail_index;
	}
	else {
		var geometry = new THREE.BufferGeometry();
		geometry.addAttribute( "position", new THREE.BufferAttribute(new Float32Array(18), 3) ); // 2 triangular faces * 3 vertices/face * 3 coordinates/vertex = 18 vertices
		geometry.addAttribute( "normal", new THREE.BufferAttribute(new Float32Array(18), 3) );
		var trail_array = geometry.attributes.position.array;
		var normal_array = geometry.attributes.normal.array;
		var index = 0;
	}
	var normal = new THREE.Vector3().crossVectors( minus(vertex_array[1], vertex_array[0]), minus(vertex_array[3], vertex_array[1]) ); // Approximate normal to quadrilateral (quadrilateral need not be planar)
	normal.normalize(); // normalizing the zero vector seems to leave it unchanged
	var faces = [0, 1, 2, 2, 3, 0]; // The first face is formed by the first three vertices in "vertex_array", and the second by the first and last two vertices
	for (var i = 0; i < faces.length; i++) {
		trail_array[index + 3 * i] = vertex_array[faces[i]].x;
		trail_array[index + 3 * i + 1] = vertex_array[faces[i]].y;
		trail_array[index + 3 * i + 2] = vertex_array[faces[i]].z;
		normal_array[index + 3 * i] = normal.x;
		normal_array[index + 3 * i + 1] = normal.y;
		normal_array[index + 3 * i + 2] = normal.z;
	}
	return geometry;
}

function minus(v1, v2) {
	return new THREE.Vector3(v1.x - v2.x, v1.y - v2.y, v1.z - v2.z);
}

/* CLIENT-SERVER COMMUNICATION */

function send_data() {
	socket.emit("status", {
		id: own_id,
		x_frac: x_frac,
		y_frac: y_frac,
		click: own_player.click,
		roll: roll
	});
}

socket.on("update", function(status) {
	if ( (screen_status == "waiting" || screen_status == "game") && players.has(status.id) && !players.get(status.id).destroyed ) {
		var player = players.get(status.id);
		if (player.seq < status.seq) {
			player.setRotationFromEuler( new THREE.Euler(status.rot._x, status.rot._y, status.rot._z, status.rot._order) );
			player.position.set(status.pos.x, status.pos.y, status.pos.z);
			if (status.id == own_id) {
				update_bounds();
				update_gas(status.gas);
			}
			else {
				player.click = status.click;
			}
			player.rotate_prop();
			player.updateMatrixWorld(); 
			player.add_trail( player.get_coords() );
			player.seq = status.seq;
			requestAnimationFrame(render);
		}
	}
});

socket.on("scores", function(array) {
	for (var player of array) {
		if (players.has(player.plane_id)) {
			players.get(player.plane_id).score = player.score;
		}
		else {
			players.set(player.plane_id, {score: player.score, disconnected: false});
		}
	}
	calculate_rank();
});

socket.on("score", function(plane_id) {
	if (players.has(plane_id)) {
			players.get(plane_id).score++;
	}
	else { // Client has not yet received information about player
		players.set( plane_id, {score: 1, disconnected: false} );
	}
	calculate_rank();
});

function calculate_rank() {
	var current_rank = 1;
	for ( player of players.values() ) {
		current_rank += (player.score > own_player.score) ? 1 : 0;
	}
	rank.innerHTML = "Rank: " + current_rank + '/' + players.size;
	if (score_table.style.visibility == "visible") {
		score_table.style.visibility = "hidden";
		draw_scoreboard();
	}
}

function render() {
	for ( var player of players.values() ) {
		player.trail_geometry.attributes.position.needsUpdate = true;
		player.trail_geometry.attributes.normal.needsUpdate = true;
	}
	renderer.render(scene, camera);
}

socket.on("id", function(status) {
	console.log("ID:", status);
	if (own_id != -1) {
		own_player.remove(camera);
	}
	own_id = status.id;
	roll = "None";
	x_frac = 0;
	y_frac = 0;
	own_player = new Player(status.id, status.pos, status.rot, own_player.click, status.user_name);
	own_player.add_camera();
	if (screen_status == "waiting") {
		screen_status = "game";
		set_visibility("game");
	}
	calculate_rank();
	requestAnimationFrame(render);
	send_data_id = setInterval(send_data, send_interval);
});

socket.on("add", function(status) {
	console.log("Adding:", status);
	var player = new Player(status.id, status.pos, status.rot, false, status.user_name);
	if (player) { // Do not proceed if the player has already been destroyed
		player.create_trail(status.trail, status.seq);
		calculate_rank();
	}
});

socket.on("destroy", function(status) {
	if ( players.has(status.id) ) {
		if (status.reason == "disconnection") {
			scene.remove( players.get(status.id) );
			scene.remove( players.get(status.id).trail_mesh );
			players.delete(status.id);
			calculate_rank();
		}
		else {
			explode( players.get(status.id) );
		}
		players.delete(status.id);
	}
	else {
		players.set( status.id, {score: 0, disconnected: true} );
		// Player disconnected before connect message received
	}
	if (status.id == own_id) {
		clearInterval(send_data_id);
		own_id = -1;
	}
});

socket.on("config", function(config) {
	initial_gas = config.initial_gas;
	trail_length = config.trail_length;
	inner_radius = config.inner_radius;
	outer_radius = config.outer_radius;
	seconds_left = config.seconds_left;
	num_trail_vertices = (trail_length - 1) * 18;
	players = new Map();
	camera = new THREE.PerspectiveCamera(field_of_view, window.innerWidth/game_height, 0.1, 1000);
	scene = new THREE.Scene();
	draw_moon();
	draw_background();
	draw_bounds();
	update_gas();
	draw_time();
});

socket.on("time", function(sl) {
	seconds_left = sl;
	draw_time();
});

socket.on("result", function(results) {
	clearInterval(send_data_id);
	results.sort( (a, b) => a.score > b.score ? -1 : 1 );
	display_results(results);
	screen_status = "end";
	set_visibility("text");
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
		format_text(enter_name + user_name + start_message);
	}
	if (screen_status == "end") {
		display_results();
	}

	requestAnimationFrame(render);
});

window.addEventListener("mousedown", function() {
	own_player.click = true;
});

window.addEventListener("mouseup", function() {
	own_player.click = false;
});

window.addEventListener("keydown", function(e) {
	if (screen_status != "game" ) {
		if (e.key == "Enter") {
			if (screen_status == "end") {
				screen_status = "start";
				format_text(enter_name + user_name + start_message);
			}
			else if (screen_status == "start") {
				screen_status = "waiting";
				socket.emit("start", user_name);
			}
		}
		else if ( e.key.length == 1 && e.key.match(accepted_characters) ) {
			user_name += e.key;
			format_text(enter_name + user_name + start_message);
		}
		else if (e.key == "Backspace") {
			user_name = user_name.slice(0, -1);
			format_text(enter_name + user_name + start_message);
		}
	}
	else {
		if (e.key == "a" || e.key == "A") {
			roll = "CCW";
		}
		else if (e.key == "d" || e.key == "D") {
			roll = "CW";
		}
		else if (e.key == " ") {
			draw_scoreboard();
		}
	}
});
window.addEventListener("keyup", function(e) {
	if (e.key == "a" || e.key == "A") {
		roll = (roll == "CCW" ? "None" : "CW");
	}
	else if (e.key == "d" || e.key == "D") {
		roll = (roll == "CW" ? "None" : "CCW");
	}
});


/* GRAPHICS */

function Player(plane_id, pos, rot, click, user_name) {
	// Add plane and subsidiary objects to scene
	var material = plane_material.clone();
	THREE.Mesh.call(this, plane_geometry, material);
	this.prop = new THREE.Mesh(prop_geometry, material);
	this.prop.position.set(0, 5.7, 0.8);
	this.add(this.prop);
	this.left_guide = new THREE.Object3D();
	this.right_guide = new THREE.Object3D();
	this.left_guide.position.set(-7, 2, 0);
	this.right_guide.position.set(7, 2, 0);
	this.add(this.left_guide);
	this.add(this.right_guide);
	this.position.set(pos.x, pos.y, pos.z);
	this.setRotationFromEuler( new THREE.Euler(rot._x, rot._y, rot._z, rot._order) );
	this.updateMatrixWorld();
	scene.add(this);
	// Initialize values
	this.seq = 1;
	this.click = click;
	this.plane_id = plane_id;
	this.fade_id = -1;
	this.destroyed = false;
	this.user_name = user_name;
	this.score = players.has(plane_id) ? players.get(plane_id).score : 0;
	players.set(plane_id, this);
	// Add trail
	this.old_coords = { left: this.left_guide.getWorldPosition(), right: this.right_guide.getWorldPosition() };
	this.trail_index = 0; // The index into which to insert the next vertices 
	this.trail_geometry = new THREE.BufferGeometry();
	this.trail_mesh = new THREE.Mesh(this.trail_geometry, (own_id == plane_id) ? own_material : other_material);
	this.trail_mesh.frustumCulled = false;
	scene.add(this.trail_mesh);
	var trail_vertices = new Float32Array(num_trail_vertices);
	var position_buffer = new THREE.BufferAttribute(trail_vertices, 3); // Holds the coordinates of the vertices in the trail
	this.trail_geometry.addAttribute("position", position_buffer);
	var trail_normals = new Float32Array(num_trail_vertices);
	var normal_buffer = new THREE.BufferAttribute(trail_normals, 3); // Holds the normals to each triangle in the trail
	this.trail_geometry.addAttribute("normal", normal_buffer);
}

Player.prototype = Object.create(THREE.Mesh.prototype);
Player.prototype.constructor = Player;
Player.prototype.rotate_prop = function() {
	this.prop.rotateY(this.click ? fast_rotate : slow_rotate);
}

Player.prototype.get_coords = function() {
	return { left: this.left_guide.getWorldPosition(), right: this.right_guide.getWorldPosition() };
}

Player.prototype.add_trail = function(new_coords) {
	this.seq++;
	if (this.old_coords.left.distanceTo(new_coords.left) < outer_radius / 2) { // Plane did not leave arena
		draw_quadrilateral( [this.old_coords.left, this.old_coords.right, new_coords.right, new_coords.left], player = this );
	}
	else {
		draw_quadrilateral( [new_coords.left, new_coords.right, new_coords.right, new_coords.left], player = this );
	}
	this.trail_index = (this.trail_index + 18) % num_trail_vertices;
	this.old_coords = new_coords;
}

Player.prototype.create_trail = function(trail, seq) {
	for ( var i = 0; i < trail.length; i++ ) {
		var new_coords = {
			left : new THREE.Vector3(trail[i].left.x, trail[i].left.y, trail[i].left.z),
			right : new THREE.Vector3(trail[i].right.x, trail[i].right.y, trail[i].right.z )
		};
		this.add_trail(new_coords);
	}
	this.seq = seq;
}

Player.prototype.add_camera = function() {
	this.add(camera);
	camera.position.set(camera_position.x, camera_position.y, camera_position.z);
	camera.lookAt(camera_position.x, camera_position.y + 1, camera_position.z);
	var light = new THREE.PointLight(0xffffff, 2, 200);
	light.position.set(0, 0, 0);
	this.add(light);
}

function draw_background() {
	var material = new THREE.MeshBasicMaterial( {color: 0xffffff} );
	var merged_geometry = new THREE.Geometry();
	var geometries = [];
	for (var i = 0; i < 3; i++) {
		geometries.push( new THREE.SphereGeometry(1 + i / 3, 3, 2) );
	}
	for (var i = 0; i < num_stars; i++) {
		let r = Math.random() * outer_radius + outer_radius + star_offset;
		let theta = Math.random() * 2 * Math.PI;
		let phi = Math.random() * Math.PI;
		let star = new THREE.Object3D();
		star.position.set(
			r * Math.sin(theta) * Math.cos(phi),
			r * Math.sin(theta) * Math.sin(phi),
			r * Math.cos(theta)
		);
		star.position.addScalar(outer_radius);
		star.updateMatrix();
		merged_geometry.merge(geometries[i % 3], star.matrix);
	}
	var stars = new THREE.Mesh(merged_geometry, material);
	scene.add(stars);
	stars.matrixAutoUpdate = false;
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

function draw_moon() {
	var material = new THREE.MeshLambertMaterial( {map: moon_texture} );
	var geometry = new THREE.SphereGeometry(inner_radius, 32, 32);
	var moon = new THREE.Mesh(geometry, material);
	moon.position.set(outer_radius, outer_radius, outer_radius);
	scene.add(moon);
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
	var geometry0 = draw_quadrilateral( [p0, p1, p2, p3] );
	sides.x0 = new THREE.MeshBasicMaterial(bounds_back);
	scene.add( new THREE.Mesh(geometry0, sides.x0) );
	var geometry1 = draw_quadrilateral( [p4, p5, p6, p7] );
	sides.x1 = new THREE.MeshBasicMaterial(bounds_front);
	scene.add( new THREE.Mesh(geometry1, sides.x1) );
	var geometry2 = draw_quadrilateral( [p0, p1, p5, p4] );
	sides.y0 = new THREE.MeshBasicMaterial(bounds_front);
	scene.add( new THREE.Mesh(geometry2, sides.y0) );
	var geometry3 = draw_quadrilateral( [p3, p2, p6, p7] );
	sides.y1 = new THREE.MeshBasicMaterial(bounds_back);
	scene.add( new THREE.Mesh(geometry3, sides.y1) );
	var geometry4 = draw_quadrilateral( [p0, p3, p7, p4] );
	sides.z0 = new THREE.MeshBasicMaterial(bounds_back);
	scene.add( new THREE.Mesh(geometry4, sides.z0) );
	var geometry5 = draw_quadrilateral( [p1, p2, p6, p5] );
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
	timer.innerHTML = "Time remaining: " + Math.floor(seconds_left / 60) + ":" + (seconds_left % 60 < 10 ? "0" : "") + (seconds_left % 60);
}

/* MISC */

function explode(player) {
	player.destroyed = true;
	scene.remove(player.trail_mesh);
	player.material.transparent = true;
	player.fade_id = setInterval(fade_away, fade_rate, player);
}

function fade_away(player) {
	if (player.material.opacity <= 0) {
		clearInterval(player.fade_id);
		scene.remove(player);
		scene.remove(player.trail_mesh);
		requestAnimationFrame(render);
	}
	else {
		player.material.opacity -= fade_increment;
		requestAnimationFrame(render);
	}
}

function draw_scoreboard() {
	var new_body = document.createElement("tbody");
	score_table.replaceChild(new_body, score_table_body);
	score_table_body = new_body;
	score_table_cells = [];
	for (var i = 0; i < players.size; i++) {
		new_row = score_table.insertRow();
		score_table_cells.push( {name:  new_row.insertCell(), score: new_row.insertCell()} );
	}
	if (score_table.style.visibility == "visible") {
		score_table.style.visibility = "hidden";
		return;
	}
	score_table.style.visibility = "visible";
	var player_info = [];
	for ( var player of players.values() ) {
		if (!player.disconnected) {
			player_info.push( { user_name: player.user_name, plane_id: player.plane_id, score: player.score} );
		}
	}
	player_info.sort( (a, b) => (a.score > b.score) ? -1 : 1 );
	for (var i = 0; i < player_info.length; i++) {
		if (player_info[i].plane_id == own_id) {
			score_table_cells[i].name.innerHTML = "<strong>" + player_info[i].user_name + "</strong>";
			score_table_cells[i].score.innerHTML = "<strong>" + player_info[i].score + "</strong>";
		}
		else {
			score_table_cells[i].name.innerHTML = player_info[i].user_name;
			score_table_cells[i].score.innerHTML = player_info[i].score;
		}
	}
}

function set_visibility(type) {
	// Determine whether game elements (e.g., timer) or text elements (e.g., ranking) should be visible
	if (type == "game") {
		main_screen.style.visibility = "hidden";
		game_screen.style.visibility = "visible";
		gas_bar.style.visibility = "visible";
		timer.style.visibility = "visible";
		rank.style.visibility = "visible";
		score_table.visibility = "visible";
	}
	else if (type == "text") {
		main_screen.style.visibility = "visible";
		game_screen.style.visibility = "hidden";
		gas_bar.style.visibility = "hidden";
		timer.style.visibility = "hidden";
		rank.style.visibility = "hidden";
		score_table.visibility = "hidden";
	}
}

set_visibility("text");
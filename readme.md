A three-dimensional version of Snake.

Running the game:

To run the game, execute the server-side code (stored in the file "server.js") using Node.js, then open a connection to the server on port 3000 using a standard browser.

Documentation:

The following variables can be configured on the server side:

(1) "initial_gas": amount of gas each player initially receives\n
(2) "outer_radius": half of width/length/height of the playing area
(3) "cell_dim": dimension of the cubes into which the playing area is partitioned  Decreasing the dimension requires more memory, but boosts performance
(4) "refresh_time": time (in milliseconds) between successive updates of the game state.
(5) "initial_seconds": length (in seconds) of a round
(6) "respawn_time": interval (in milliseconds) between a player's plane being destroyed and its being redeployed
(7) "normal_speed": distance travelled by a player's plane between successive updates when the mouse is not depressed
(8) "fast_speed": distance travelled by a player's plane between successive updates when the mouse is depressed
(9) "turn_speed": multiplies the rate at which a player's plane rotates (the base rate being determined by the player's mouse position)
(10) "trail_length": maximum length of trail which can be left in player's plane's wake, measured in number of parallelograms (see "Collision-detection mechanism" for more information)

The following information is transmitted between the player and the server:

(1) "x_frac": left/right displacement of the player's mouse from center of screen, as fraction of the distance to window's right edge (ranges from -1 to 1)
(2) "y_frac": up/down displacement of the player's mouse from center of screen, as fraction of the distance to window's upper edge (ranges from -1 to 1)
(3) "click": whether or not player's mouse is depressed

Collision-detection mechanism:

The collision-detection functionality is implemented by "intersects", which checks for a collision between a parallelogram and a line segment, and "update_trail", which associates each parallelogram with a particular matrix.

Given a parallelogram with consecutive verticies {p1, p2, p3, p4}, we define v1 as the vector running from p1 to p2 and v2 as the vector running from p1 to p3.  We then let v3 be their cross-product, and form the matrix [v1 v2 v3].  "update trail" associates the inverse of this matrix, which can be thought of as a change-of-basis matrix from the standard basis to {v1, v2, v3}, with the parallelogram.

Given a parallelogram and a line segment, "intersects" first checks whether the plane containing the parallelogram intersects the line containing the line segment, and, if so, calculates the point of intersection, q.  The above-mentioned matrix is then applied to the vector q - p1 (which runs from a corner of the parallelogram to q), expressed in the standard basis; the result is the same vector expressed in the new basis.  By our choice of basis, all the vectors whose coordinates are drawn from the set [0, 1] x [0, 1] x {0} lie on the parallelogram.  It merely remains to check whether the first two coordinates of our vector lie between 0 and 1 (the third coordinate will always be approximately 0, because q lies on the plane containing the parallelogram, and so q-p is linear combination of v1 and v2).

In practice, p1 and p2 are positions of two markers attached to the player's plane at one instant, and p3 is the position of the first marker at the next instant.  One pair is "left_guide" and "right_guide" and the other is "top_guide" and "bottom_guide".

Server-side data:

The playing area is partitioned into a number of cubes.  Each cube is associated with the set "neighbors" of the cube itself and the cubes surrounding it, the set "planes" of players' planes whose centers are currently within that cube, and the set "trails" of parallelograms whose centers are within that cube.  On each turn, and for each player, we check for collisions between the player's plane and the parallelograms contained in nearby cubes.

When a player joins the game, the server associates an object (constructed by the function "Player") with the player.  This object contains Object3D.prototype in its prototype chain, and calls the standard Object3D constructor, and so inherits certain properties and functions.  In addition to these, it has the following properties:

(1) "gas": amount of gas remaining
(2) "collision_data": an array of length "trail_length" - 1 containing matrix associated with particular p

Game-play mechanics:


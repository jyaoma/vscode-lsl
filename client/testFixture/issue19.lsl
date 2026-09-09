float CROSS_TIME = 123;

default {
    state_entry()
    {
        if (llGetTime() < CROSS_TIME)
        {
            /*
            During the sim-crossing time,
            blah blah, some multiline comment...
            */
        }
    }
}
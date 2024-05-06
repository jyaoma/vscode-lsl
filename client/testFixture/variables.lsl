integer global = 0;

myFunc(float z) {
    vector x = <2, 3, z>;
    
    llSay(PUBLIC_CHANNEL, (string)x.y);
}


default
{
    state_entry()
    {
        key eventHandlerScoped = NULL_KEY;

        llSay(global, "123");

        if (eventHandlerScoped == NULL_KEY) {
            string ifBlockScoped = "123";
        } else {
            ifBlockScoped = "456";
        }

        if (TRUE) string throwaway = "555";
        else llSay(global, eventHandlerScoped);
    }

    touch_start(integer num_detected)
    {
        if (TRUE) {
            llSay(num_detected, "oof"); 
        }
        global = 5;
    }
}